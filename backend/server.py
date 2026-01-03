from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import httpx
from datetime import datetime, timedelta
import time
from collections import deque

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Torn API Base URL
TORN_API_BASE = "https://api.torn.com"

# Rate limiting and caching
request_timestamps = deque(maxlen=100)  # Track last 100 requests
cache = {}  # Simple cache: {cache_key: (data, expiry_time)}
CACHE_DURATION = 30  # Cache for 30 seconds (API caches for 29s)

# Define Models
class APIKeyUpdate(BaseModel):
    api_key: str

class APIKeyResponse(BaseModel):
    has_key: bool
    key_preview: Optional[str] = None
    is_disabled: Optional[bool] = False

class BuddyStockCreate(BaseModel):
    user_id: int
    item_name: str
    interval_days: int

class BuddyStockResponse(BaseModel):
    id: str
    user_id: int
    user_name: str
    item_name: str
    interval_days: int
    last_received: Optional[datetime] = None
    next_due: Optional[datetime] = None
    days_until_due: Optional[int] = None
    is_overdue: bool = False

# Helper functions for rate limiting and caching
def check_rate_limit() -> bool:
    """Check if we're within rate limits (100 requests per minute)"""
    current_time = time.time()
    # Remove requests older than 60 seconds
    while request_timestamps and current_time - request_timestamps[0] > 60:
        request_timestamps.popleft()
    
    # Check if we've hit the limit
    if len(request_timestamps) >= 95:  # Stay under 100 for safety
        logger.warning("Rate limit approaching, slowing down requests")
        return False
    return True

def get_from_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    """Get data from cache if not expired"""
    if cache_key in cache:
        data, expiry_time = cache[cache_key]
        if time.time() < expiry_time:
            logger.info(f"Cache hit for {cache_key}")
            return data
        else:
            # Remove expired cache entry
            del cache[cache_key]
    return None

def save_to_cache(cache_key: str, data: Dict[str, Any]):
    """Save data to cache with expiry"""
    expiry_time = time.time() + CACHE_DURATION
    cache[cache_key] = (data, expiry_time)

# Helper function to get API key from database
async def get_api_key() -> Optional[str]:
    """Retrieve the stored API key from database"""
    settings = await db.settings.find_one({"type": "api_key"})
    if settings:
        # Check if key is marked as disabled
        if settings.get("disabled", False):
            raise HTTPException(
                status_code=403,
                detail="API key is disabled due to previous errors. Please update your API key in settings."
            )
        return settings.get("key")
    return None

async def disable_api_key(reason: str):
    """Disable the API key in database when errors occur"""
    logger.error(f"Disabling API key: {reason}")
    await db.settings.update_one(
        {"type": "api_key"},
        {"$set": {"disabled": True, "disabled_reason": reason, "disabled_at": datetime.utcnow()}}
    )

# Helper function to make Torn API requests
async def fetch_torn_api(endpoint: str, selections: str) -> Dict[str, Any]:
    """Make a request to Torn API with rate limiting, caching, and error handling"""
    
    # Check cache first
    cache_key = f"{endpoint}:{selections}"
    cached_data = get_from_cache(cache_key)
    if cached_data:
        return cached_data
    
    # Check rate limit
    if not check_rate_limit():
        raise HTTPException(
            status_code=429,
            detail="Rate limit approaching. Please wait a moment before making more requests."
        )
    
    api_key = await get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key not configured. Please set your Torn API key in settings.")
    
    url = f"{TORN_API_BASE}/{endpoint}?selections={selections}&key={api_key}"
    
    try:
        # Record this request for rate limiting
        request_timestamps.append(time.time())
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
            
            # Check for Torn API errors
            if "error" in data:
                error_code = data["error"].get("code")
                error_msg = data["error"].get("error", "Unknown error")
                logger.error(f"Torn API Error {error_code}: {error_msg}")
                
                # Handle critical errors that require disabling the key
                if error_code in [2, 13, 18]:  # Incorrect key, inactive user, key paused
                    await disable_api_key(f"Error {error_code}: {error_msg}")
                    raise HTTPException(
                        status_code=403,
                        detail=f"API key error: {error_msg}. Please update your API key in settings."
                    )
                elif error_code == 5:  # Too many requests
                    raise HTTPException(
                        status_code=429,
                        detail="Torn API rate limit exceeded. Please wait before making more requests."
                    )
                else:
                    raise HTTPException(status_code=400, detail=f"Torn API Error: {error_msg}")
            
            # Cache successful response
            save_to_cache(cache_key, data)
            
            return data
    except httpx.HTTPError as e:
        logger.error(f"HTTP error occurred: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch data from Torn API: {str(e)}")
    except HTTPException:
        raise  # Re-raise HTTPExceptions as-is
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Torn Dashboard API", "status": "running"}

@api_router.get("/status")
async def get_status():
    """Get API status including rate limit information"""
    current_time = time.time()
    # Count requests in the last minute
    recent_requests = sum(1 for ts in request_timestamps if current_time - ts < 60)
    
    return {
        "status": "running",
        "requests_last_minute": recent_requests,
        "rate_limit": 95,  # Our safety limit
        "cache_entries": len(cache),
        "cache_duration": CACHE_DURATION
    }

@api_router.post("/settings/api-key")
async def update_api_key(data: APIKeyUpdate):
    """Update the Torn API key with validation"""
    try:
        # Validate the API key by making a test request
        url = f"{TORN_API_BASE}/user/?selections=basic&key={data.api_key}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            result = response.json()
            
            if "error" in result:
                error_code = result["error"].get("code")
                error_msg = result["error"].get("error", "Invalid API key")
                
                # Log the specific error code for debugging
                logger.warning(f"API key validation failed with error code {error_code}: {error_msg}")
                
                raise HTTPException(status_code=400, detail=f"Invalid API key: {error_msg}")
        
        # Store the API key in database and clear any disabled flag
        await db.settings.update_one(
            {"type": "api_key"},
            {
                "$set": {
                    "key": data.api_key,
                    "updated_at": datetime.utcnow(),
                    "disabled": False  # Re-enable if previously disabled
                },
                "$unset": {
                    "disabled_reason": "",
                    "disabled_at": ""
                }
            },
            upsert=True
        )
        
        # Clear cache when API key is updated
        cache.clear()
        
        logger.info("API key updated successfully and re-enabled")
        return {"success": True, "message": "API key saved successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating API key: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/settings/api-key", response_model=APIKeyResponse)
async def get_api_key_status():
    """Check if API key is configured and its status"""
    try:
        settings = await db.settings.find_one({"type": "api_key"})
        if settings and settings.get("key"):
            api_key = settings.get("key")
            is_disabled = settings.get("disabled", False)
            # Return first 4 and last 4 characters for preview
            preview = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "****"
            return APIKeyResponse(has_key=True, key_preview=preview, is_disabled=is_disabled)
        return APIKeyResponse(has_key=False, is_disabled=False)
    except Exception as e:
        logger.error(f"Error getting API key status: {e}")
        return APIKeyResponse(has_key=False, is_disabled=False)

@api_router.get("/user/dashboard")
async def get_dashboard_data():
    """Get all dashboard data in one request"""
    try:
        # Fetch comprehensive user data
        data = await fetch_torn_api(
            "user",
            "basic,personalstats,bars,cooldowns,notifications,money,networth,battlestats"
        )
        
        # Process and structure the response
        dashboard_data = {
            "profile": {
                "player_id": data.get("player_id"),
                "name": data.get("name"),
                "level": data.get("level"),
                "rank": data.get("rank"),
                "gender": data.get("gender"),
                "status": data.get("status"),
            },
            "bars": {
                "energy": {
                    "current": data.get("energy", {}).get("current", 0),
                    "maximum": data.get("energy", {}).get("maximum", 100),
                    "interval": data.get("energy", {}).get("interval", 0),
                    "ticktime": data.get("energy", {}).get("ticktime", 0),
                },
                "nerve": {
                    "current": data.get("nerve", {}).get("current", 0),
                    "maximum": data.get("nerve", {}).get("maximum", 100),
                    "interval": data.get("nerve", {}).get("interval", 0),
                    "ticktime": data.get("nerve", {}).get("ticktime", 0),
                },
                "happy": {
                    "current": data.get("happy", {}).get("current", 0),
                    "maximum": data.get("happy", {}).get("maximum", 100),
                    "interval": data.get("happy", {}).get("interval", 0),
                    "ticktime": data.get("happy", {}).get("ticktime", 0),
                },
                "life": {
                    "current": data.get("life", {}).get("current", 0),
                    "maximum": data.get("life", {}).get("maximum", 100),
                },
                "chain": {
                    "current": data.get("chain", {}).get("current", 0),
                    "maximum": data.get("chain", {}).get("maximum", 100),
                    "timeout": data.get("chain", {}).get("timeout", 0),
                },
            },
            "money": {
                "cash": data.get("money", 0),
                "points": data.get("points", 0),
                "bank": data.get("networth", {}).get("bank", 0),
                "networth": data.get("networth", {}).get("total", 0),
            },
            "battle_stats": {
                "strength": data.get("strength", 0),
                "defense": data.get("defense", 0),
                "speed": data.get("speed", 0),
                "dexterity": data.get("dexterity", 0),
                "total": data.get("total", 0),
            },
            "cooldowns": data.get("cooldowns", {}),
            "notifications": data.get("notifications", {}),
            "last_updated": datetime.utcnow().isoformat()
        }
        
        return dashboard_data
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching dashboard data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/user/events")
async def get_user_events():
    """Get recent user events"""
    try:
        data = await fetch_torn_api("user", "events")
        events = data.get("events", {})
        
        # Convert events dict to list and sort by timestamp
        events_list = []
        for event_id, event_data in events.items():
            events_list.append({
                "id": event_id,
                **event_data
            })
        
        # Sort by timestamp descending
        events_list.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        
        return {"events": events_list[:20]}  # Return latest 20 events
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Buddy Stocks Endpoints
@api_router.post("/buddy-stocks")
async def create_buddy_stock(buddy_stock: BuddyStockCreate):
    """Add a new buddy stock tracker"""
    try:
        # Fetch user info from Torn API to get their name
        user_data = await fetch_torn_api("user", f"basic&id={buddy_stock.user_id}")
        user_name = user_data.get("name", f"User {buddy_stock.user_id}")
        
        # Create buddy stock document
        buddy_stock_doc = {
            "user_id": buddy_stock.user_id,
            "user_name": user_name,
            "item_name": buddy_stock.item_name,
            "interval_days": buddy_stock.interval_days,
            "last_received": None,
            "next_due": None,
            "created_at": datetime.utcnow()
        }
        
        result = await db.buddy_stocks.insert_one(buddy_stock_doc)
        
        logger.info(f"Created buddy stock: {user_name} - {buddy_stock.item_name}")
        return {
            "success": True,
            "buddy_stock": {
                "id": str(result.inserted_id),
                **buddy_stock_doc
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating buddy stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/buddy-stocks")
async def get_buddy_stocks():
    """Get all buddy stocks with calculated due dates"""
    try:
        buddy_stocks = await db.buddy_stocks.find().to_list(1000)
        
        # Process each buddy stock to calculate days until due
        result = []
        current_time = datetime.utcnow()
        
        for stock in buddy_stocks:
            stock["id"] = str(stock.pop("_id"))
            
            # Calculate days until due
            if stock.get("next_due"):
                next_due = stock["next_due"]
                time_diff = next_due - current_time
                days_until = time_diff.days
                stock["days_until_due"] = days_until
                stock["is_overdue"] = days_until < 0
            else:
                stock["days_until_due"] = None
                stock["is_overdue"] = False
            
            result.append(stock)
        
        # Sort by days until due (overdue first, then soonest)
        result.sort(key=lambda x: (
            not x["is_overdue"],
            x["days_until_due"] if x["days_until_due"] is not None else 999999
        ))
        
        return {"buddy_stocks": result}
    
    except Exception as e:
        logger.error(f"Error fetching buddy stocks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/buddy-stocks/{stock_id}/received")
async def mark_buddy_stock_received(stock_id: str):
    """Mark a buddy stock item as received"""
    try:
        from bson import ObjectId
        
        # Get the buddy stock
        stock = await db.buddy_stocks.find_one({"_id": ObjectId(stock_id)})
        if not stock:
            raise HTTPException(status_code=404, detail="Buddy stock not found")
        
        # Calculate next due date
        current_time = datetime.utcnow()
        next_due = current_time + timedelta(days=stock["interval_days"])
        
        # Update the buddy stock
        await db.buddy_stocks.update_one(
            {"_id": ObjectId(stock_id)},
            {
                "$set": {
                    "last_received": current_time,
                    "next_due": next_due,
                    "updated_at": current_time
                }
            }
        )
        
        logger.info(f"Marked buddy stock as received: {stock['user_name']} - {stock['item_name']}")
        return {
            "success": True,
            "last_received": current_time,
            "next_due": next_due
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking buddy stock as received: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/buddy-stocks/{stock_id}")
async def delete_buddy_stock(stock_id: str):
    """Delete a buddy stock tracker"""
    try:
        from bson import ObjectId
        
        result = await db.buddy_stocks.delete_one({"_id": ObjectId(stock_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Buddy stock not found")
        
        logger.info(f"Deleted buddy stock: {stock_id}")
        return {"success": True, "message": "Buddy stock deleted"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting buddy stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
