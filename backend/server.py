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

class ItemData(BaseModel):
    name: str
    id: int
    value: int

class InvestorSplit(BaseModel):
    user_id: int
    user_name: Optional[str] = None  # Optional, will be fetched from API if not provided
    split_percentage: float
    item_name: Optional[str] = None  # Item they're sending (e.g., "Drug Pack") - legacy single item
    item_id: Optional[int] = None  # Torn item ID - legacy single item
    market_value: Optional[int] = None  # Current market value - legacy single item
    items: Optional[list[ItemData]] = None  # New: multiple items support

class StockCreate(BaseModel):
    stock_name: str
    start_date: str  # YYYY-MM-DD format
    days_per_payout: int
    total_cost: int
    payout_value: int
    blank_payment: int
    investors: list[InvestorSplit]
    payouts_received: int = 0  # Track how many payouts have been received
    max_payouts: int = 100  # Default to 100 payouts for "ongoing" investments

class StockUpdate(BaseModel):
    stock_name: Optional[str] = None
    start_date: Optional[str] = None
    days_per_payout: Optional[int] = None
    total_cost: Optional[int] = None
    payout_value: Optional[int] = None
    blank_payment: Optional[int] = None
    investors: Optional[list[InvestorSplit]] = None
    payouts_received: Optional[int] = None  # Track received payouts
    max_payouts: Optional[int] = None  # Maximum payouts for ongoing investments

class PaymentSchedule(BaseModel):
    payment_number: int
    due_date: str  # YYYY-MM-DD
    paid: bool = False
    paid_date: Optional[str] = None
    investor_payments: list[dict] = []  # [{user_id, user_name, amount, item_name, paid}]
    log_entry: Optional[str] = None

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

@api_router.get("/items/search")
async def search_item(name: str):
    """Search for item by name and get market value"""
    try:
        # Fetch all items from Torn
        items_data = await fetch_torn_api("torn", "items")
        
        # Search for item by name (case-insensitive)
        search_name = name.lower()
        matched_item = None
        
        for item_id, item_info in items_data.get("items", {}).items():
            if search_name in item_info.get("name", "").lower():
                matched_item = {
                    "id": int(item_id),
                    "name": item_info.get("name"),
                    "market_value": item_info.get("market_value", 0),
                    "description": item_info.get("description", "")
                }
                break
        
        if not matched_item:
            raise HTTPException(status_code=404, detail=f"Item '{name}' not found")
        
        return matched_item
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching item: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

# Stock Investment Endpoints
@api_router.post("/stocks")
async def create_stock(stock: StockCreate):
    """Create a new stock investment"""
    try:
        from dateutil import parser
        
        # Validate and parse start date
        try:
            start_date = parser.parse(stock.start_date).date()
        except:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
        
        # Validate investors total to 100%
        total_split = sum(inv.split_percentage for inv in stock.investors)
        if abs(total_split - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"Investor splits must total 100%, currently {total_split}%")
        
        # Fetch investor names from Torn API
        investors_with_names = []
        for inv in stock.investors:
            try:
                # Use user/{id} endpoint to get correct user info
                user_data = await fetch_torn_api(f"user/{inv.user_id}", "basic")
                user_name = user_data.get("name", f"User {inv.user_id}")
            except:
                user_name = f"User {inv.user_id}"
            
            investor_data = {
                "user_id": inv.user_id,
                "user_name": user_name,
                "split_percentage": inv.split_percentage,
                "item_name": inv.item_name,
                "item_id": inv.item_id,
                "market_value": inv.market_value
            }
            
            investors_with_names.append(investor_data)
        
        # Calculate total payouts (use max_payouts for ongoing investments)
        total_payouts = stock.get("max_payouts", 100)
        
        # Create stock document
        stock_doc = {
            "stock_name": stock.stock_name,
            "start_date": stock.start_date,
            "days_per_payout": stock.days_per_payout,
            "total_cost": stock.total_cost,
            "payout_value": stock.payout_value,
            "blank_payment": stock.blank_payment,
            "investors": investors_with_names,
            "total_payouts": total_payouts,
            "payouts_received": stock.payouts_received,
            "max_payouts": stock.max_payouts,
            "created_at": datetime.utcnow()
        }
        
        result = await db.stocks.insert_one(stock_doc)
        
        logger.info(f"Created stock investment: {stock.stock_name}")
        return {
            "success": True,
            "id": str(result.inserted_id),
            "stock_name": stock.stock_name
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/stocks")
async def get_stocks():
    """Get all stock investments"""
    try:
        stocks = await db.stocks.find().to_list(1000)
        
        result = []
        for stock in stocks:
            stock["id"] = str(stock.pop("_id"))
            
            # Calculate Total Received (payouts_received × payout_value)
            payouts_received = stock.get("payouts_received", 0)
            total_received = stock["payout_value"] * payouts_received
            stock["total_received"] = total_received
            
            # Keep blake_total for backwards compatibility (total possible profit)
            total_profit = (stock["payout_value"] * stock["total_payouts"]) - stock["total_cost"]
            stock["blake_total"] = total_profit
            
            # Calculate days since start date
            try:
                start_date = datetime.strptime(stock["start_date"], "%Y-%m-%d").date()
                current_date = datetime.utcnow().date()
                days_since_start = (current_date - start_date).days
                stock["days_since_start"] = max(1, days_since_start)  # At least 1 day
            except:
                stock["days_since_start"] = 1
            
            # Calculate ROI using formula: ((100/cost)*(payout_value/days_per_payout))/100
            # This gives daily ROI, multiply by 365 for annual
            total_cost = stock["total_cost"]
            payout_value = stock["payout_value"]
            days_per_payout = stock["days_per_payout"]
            
            if total_cost > 0 and days_per_payout > 0:
                daily_roi = ((100 / total_cost) * (payout_value / days_per_payout)) / 100
                annualized_roi = daily_roi * 365 * 100  # Convert to percentage
                stock["annualized_roi"] = round(annualized_roi, 2)
            else:
                stock["annualized_roi"] = 0.0
            
            # Calculate next payout due date
            payment_schedule = stock.get("payment_schedule", [])
            next_payout_date = None
            for payment in payment_schedule:
                if not payment.get("paid", False):
                    next_payout_date = payment.get("due_date")
                    break
            stock["next_payout_due"] = next_payout_date
            
            result.append(stock)
        
        # Sort by start date descending
        result.sort(key=lambda x: x.get("start_date", ""), reverse=True)
        
        return {"stocks": result}
    
    except Exception as e:
        logger.error(f"Error fetching stocks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/stocks/{stock_id}")
async def get_stock(stock_id: str):
    """Get a single stock investment"""
    try:
        from bson import ObjectId
        
        stock = await db.stocks.find_one({"_id": ObjectId(stock_id)})
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        stock["id"] = str(stock.pop("_id"))
        
        # Calculate Total Received
        payouts_received = stock.get("payouts_received", 0)
        total_received = stock["payout_value"] * payouts_received
        stock["total_received"] = total_received
        
        # Calculate Blake Total (total possible profit)
        total_profit = (stock["payout_value"] * stock["total_payouts"]) - stock["total_cost"]
        stock["blake_total"] = total_profit
        
        # Calculate days since start date
        try:
            start_date = datetime.strptime(stock["start_date"], "%Y-%m-%d").date()
            current_date = datetime.utcnow().date()
            days_since_start = (current_date - start_date).days
            stock["days_since_start"] = max(1, days_since_start)  # At least 1 day
        except:
            stock["days_since_start"] = 1
        
        # Calculate ROI using formula: ((100/cost)*(payout_value/days_per_payout))/100
        # This gives daily ROI, multiply by 365 for annual
        total_cost = stock["total_cost"]
        payout_value = stock["payout_value"]
        days_per_payout = stock["days_per_payout"]
        
        if total_cost > 0 and days_per_payout > 0:
            daily_roi = ((100 / total_cost) * (payout_value / days_per_payout)) / 100
            annualized_roi = daily_roi * 365 * 100  # Convert to percentage
            stock["annualized_roi"] = round(annualized_roi, 2)
        else:
            stock["annualized_roi"] = 0.0
        
        # Calculate next payout due date
        payment_schedule = stock.get("payment_schedule", [])
        next_payout_date = None
        for payment in payment_schedule:
            if not payment.get("paid", False):
                next_payout_date = payment.get("due_date")
                break
        stock["next_payout_due"] = next_payout_date
        
        return stock
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/stocks/{stock_id}")
async def update_stock(stock_id: str, stock_update: StockUpdate):
    """Update a stock investment"""
    try:
        from bson import ObjectId
        
        # Get existing stock
        existing_stock = await db.stocks.find_one({"_id": ObjectId(stock_id)})
        if not existing_stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        # Build update dict
        update_data = {}
        if stock_update.stock_name is not None:
            update_data["stock_name"] = stock_update.stock_name
        if stock_update.start_date is not None:
            update_data["start_date"] = stock_update.start_date
        if stock_update.days_per_payout is not None:
            update_data["days_per_payout"] = stock_update.days_per_payout
        if stock_update.total_cost is not None:
            update_data["total_cost"] = stock_update.total_cost
        if stock_update.payout_value is not None:
            update_data["payout_value"] = stock_update.payout_value
        if stock_update.blank_payment is not None:
            update_data["blank_payment"] = stock_update.blank_payment
        if stock_update.payouts_received is not None:
            update_data["payouts_received"] = stock_update.payouts_received
        if stock_update.max_payouts is not None:
            update_data["max_payouts"] = stock_update.max_payouts
            update_data["total_payouts"] = stock_update.max_payouts
        
        # Handle investor updates
        if stock_update.investors is not None:
            # Validate splits total to 100%
            total_split = sum(inv.split_percentage for inv in stock_update.investors)
            if abs(total_split - 100.0) > 0.01:
                raise HTTPException(status_code=400, detail=f"Investor splits must total 100%, currently {total_split}%")
            
            # Fetch investor names
            investors_with_names = []
            for inv in stock_update.investors:
                try:
                    # Use user/{id} endpoint to get correct user info
                    user_data = await fetch_torn_api(f"user/{inv.user_id}", "basic")
                    user_name = user_data.get("name", f"User {inv.user_id}")
                except:
                    user_name = f"User {inv.user_id}"
                
                investor_data = {
                    "user_id": inv.user_id,
                    "user_name": user_name,
                    "split_percentage": inv.split_percentage,
                    "item_name": inv.item_name,
                    "item_id": inv.item_id,
                    "market_value": inv.market_value
                }
                
                investors_with_names.append(investor_data)
            
            update_data["investors"] = investors_with_names
        
        # No need to recalculate total_payouts for ongoing investments
        # total_payouts is set by max_payouts
        
        update_data["updated_at"] = datetime.utcnow()
        
        # Update stock
        await db.stocks.update_one(
            {"_id": ObjectId(stock_id)},
            {"$set": update_data}
        )
        
        logger.info(f"Updated stock: {stock_id}")
        return {"success": True, "message": "Stock updated successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/stocks/{stock_id}")
async def delete_stock(stock_id: str):
    """Delete a stock investment"""
    try:
        from bson import ObjectId
        
        result = await db.stocks.delete_one({"_id": ObjectId(stock_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        logger.info(f"Deleted stock: {stock_id}")
        return {"success": True, "message": "Stock deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting stock: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Payment Schedule Endpoints
def generate_payment_schedule(stock: dict) -> list:
    """Generate payment schedule for a stock"""
    from dateutil import parser
    from datetime import timedelta
    
    # Parse start date properly
    start_date_str = stock["start_date"]
    try:
        # Handle YYYY-MM-DD format
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except:
        # Fallback to dateutil parser
        start_date = parser.parse(start_date_str).date()
    
    payments = []
    
    for payment_num in range(1, stock["total_payouts"] + 1):
        # Calculate due date: start_date + (payment_num * days_per_payout)
        due_date = start_date + timedelta(days=payment_num * stock["days_per_payout"])
        
        # Calculate amount per investor based on payout value and splits
        investor_payments = []
        for inv in stock["investors"]:
            amount = int(stock["payout_value"] * (inv["split_percentage"] / 100))
            investor_payments.append({
                "user_id": inv["user_id"],
                "user_name": inv["user_name"],
                "split_percentage": inv["split_percentage"],
                "amount": amount,
                "item_name": inv.get("item_name"),
                "item_id": inv.get("item_id"),
                "paid": False
            })
        
        payments.append({
            "payment_number": payment_num,
            "due_date": due_date.isoformat(),
            "paid": False,
            "paid_date": None,
            "investor_payments": investor_payments,
            "log_entry": None
        })
    
    return payments

@api_router.get("/stocks/{stock_id}/payments")
async def get_payment_schedule(stock_id: str, regenerate: bool = False):
    """Get payment schedule for a stock"""
    try:
        from bson import ObjectId
        
        stock = await db.stocks.find_one({"_id": ObjectId(stock_id)})
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        # Check if payment schedule needs regeneration
        if "payment_schedule" not in stock or regenerate:
            payment_schedule = generate_payment_schedule(stock)
            await db.stocks.update_one(
                {"_id": ObjectId(stock_id)},
                {"$set": {"payment_schedule": payment_schedule}}
            )
            logger.info(f"Regenerated payment schedule for stock {stock_id}")
        else:
            payment_schedule = stock["payment_schedule"]
        
        return {
            "stock_id": str(stock["_id"]),
            "stock_name": stock["stock_name"],
            "payments": payment_schedule
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching payment schedule: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/stocks/{stock_id}/payments/{payment_number}/mark-paid")
async def mark_payment_paid(stock_id: str, payment_number: int, investor_user_id: Optional[int] = None):
    """Toggle payment paid status (mark/unmark)"""
    try:
        from bson import ObjectId
        
        stock = await db.stocks.find_one({"_id": ObjectId(stock_id)})
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        payment_schedule = stock.get("payment_schedule", [])
        payment_index = payment_number - 1
        
        if payment_index >= len(payment_schedule):
            raise HTTPException(status_code=404, detail="Payment not found")
        
        payment = payment_schedule[payment_index]
        
        if investor_user_id:
            # Toggle specific investor payment
            for inv_payment in payment["investor_payments"]:
                if inv_payment["user_id"] == investor_user_id:
                    # Toggle the paid status
                    inv_payment["paid"] = not inv_payment.get("paid", False)
                    break
            
            # Check if all investors paid for this payment
            all_paid = all(inv["paid"] for inv in payment["investor_payments"])
            if all_paid:
                payment["paid"] = True
                payment["paid_date"] = datetime.utcnow().isoformat()
            else:
                payment["paid"] = False
                payment["paid_date"] = None
        else:
            # Toggle entire payment
            current_status = payment.get("paid", False)
            new_status = not current_status
            
            payment["paid"] = new_status
            if new_status:
                payment["paid_date"] = datetime.utcnow().isoformat()
            else:
                payment["paid_date"] = None
            
            # Update all investor payments to match
            for inv_payment in payment["investor_payments"]:
                inv_payment["paid"] = new_status
        
        # Update payment schedule
        await db.stocks.update_one(
            {"_id": ObjectId(stock_id)},
            {"$set": {"payment_schedule": payment_schedule}}
        )
        
        # Recalculate payouts_received
        payouts_received = sum(1 for p in payment_schedule if p["paid"])
        await db.stocks.update_one(
            {"_id": ObjectId(stock_id)},
            {"$set": {"payouts_received": payouts_received}}
        )
        
        action = "marked" if payment.get("paid") else "unmarked"
        logger.info(f"{action} payment {payment_number} for stock {stock_id}")
        return {"success": True, "payouts_received": payouts_received, "paid": payment.get("paid")}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error toggling payment status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/stocks/{stock_id}/payments/check-events")
async def check_events_for_payments(stock_id: str):
    """Check Torn logs API to find matching logs for payments (does NOT mark as paid)"""
    try:
        from bson import ObjectId
        from dateutil import parser as date_parser
        
        stock = await db.stocks.find_one({"_id": ObjectId(stock_id)})
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        
        payment_schedule = stock.get("payment_schedule", [])
        detections_made = 0
        detected_logs = []
        
        # Build a map of investor user_ids to their item_ids for quick lookup
        # Now supports multiple items per investor
        investor_item_map = {}
        for inv in stock.get("investors", []):
            user_id = inv.get("user_id")
            user_name = inv.get("user_name", f"User {user_id}")
            
            # Get all item IDs (from new 'items' array or legacy single item)
            item_ids = []
            item_names = []
            if inv.get("items"):
                for item in inv["items"]:
                    item_ids.append(item["id"])
                    item_names.append(item["name"])
            elif inv.get("item_id"):
                item_ids.append(inv["item_id"])
                item_names.append(inv.get("item_name", ""))
            
            if user_id and item_ids:
                investor_item_map[user_id] = {
                    "item_ids": item_ids,
                    "item_names": item_names,
                    "user_name": user_name
                }
        
        if not investor_item_map:
            return {
                "success": False,
                "detections_made": 0,
                "detected_logs": [],
                "message": "No investors with item IDs configured. Please set item names for investors."
            }
        
        # Fetch YOUR logs (the stock owner's logs) - items received will show here
        logs_data = await fetch_torn_api("user", "log&cat=85")  # Category 85 = Item receiving
        logs = logs_data.get("log", {})
        
        logger.info(f"Fetched {len(logs)} log entries for payment detection")
        
        # Build list of all matching logs with their timestamps
        all_matching_logs = []
        for log_id, log_entry in logs.items():
            log_data = log_entry.get("data", {})
            sender_id = log_data.get("sender")
            items = log_data.get("items", [])
            log_timestamp = log_entry.get("timestamp", 0)
            
            # Check if sender is one of our investors
            if sender_id in investor_item_map:
                investor_info = investor_item_map[sender_id]
                item_ids = investor_info["item_ids"]
                item_names = investor_info["item_names"]
                
                # Check if any item in the log matches ANY of our tracked items
                for item in items:
                    log_item_id = item.get("id")
                    if log_item_id in item_ids:
                        # Find the matching item name
                        item_idx = item_ids.index(log_item_id)
                        matched_item_name = item_names[item_idx] if item_idx < len(item_names) else ""
                        all_matching_logs.append({
                            "log_id": log_id,
                            "timestamp": log_timestamp,
                            "sender_id": sender_id,
                            "item_id": log_item_id,
                            "item_name": matched_item_name,
                            "user_name": investor_info["user_name"],
                            "log_text": f"{investor_info['user_name']} sent {matched_item_name}"
                        })
                        break
        
        logger.info(f"Found {len(all_matching_logs)} total matching log entries")
        
        # Track which logs have been assigned to payments
        used_log_ids = set()
        
        # Check each payment and try to find a matching log within ±24 hours of due date
        for payment in payment_schedule:
            # Parse the due date
            try:
                due_date = datetime.strptime(payment["due_date"], "%Y-%m-%d")
            except:
                continue
            
            # Define the 24-hour window (±24 hours from due date)
            window_start = due_date - timedelta(hours=24)
            window_end = due_date + timedelta(hours=24)
            
            # Check each investor payment
            for inv_payment in payment["investor_payments"]:
                user_id = inv_payment["user_id"]
                # Get all item IDs this investor might send
                investor_info = investor_item_map.get(user_id, {})
                item_ids = investor_info.get("item_ids", [])
                
                # Also check legacy item_id
                legacy_item_id = inv_payment.get("item_id")
                if legacy_item_id and legacy_item_id not in item_ids:
                    item_ids.append(legacy_item_id)
                
                if not item_id:
                    inv_payment["detected_log"] = None
                    inv_payment["detection_status"] = "no_item_configured"
                    continue
                
                # Find a matching log within the time window
                found_log = None
                for log in all_matching_logs:
                    if log["log_id"] in used_log_ids:
                        continue
                    
                    if log["sender_id"] == user_id and log["item_id"] == item_id:
                        log_datetime = datetime.fromtimestamp(log["timestamp"])
                        
                        # Check if log is within ±24 hours of due date
                        if window_start <= log_datetime <= window_end:
                            found_log = log
                            used_log_ids.add(log["log_id"])
                            break
                
                if found_log:
                    # Store detection info but DO NOT mark as paid
                    inv_payment["detected_log_id"] = found_log["log_id"]
                    inv_payment["detected_log_text"] = found_log["log_text"]
                    log_date = datetime.fromtimestamp(found_log["timestamp"])
                    inv_payment["detected_date"] = log_date.strftime("%d/%m/%Y %H:%M")
                    inv_payment["detection_status"] = "found"
                    
                    detections_made += 1
                    detected_logs.append({
                        "payment_number": payment["payment_number"],
                        "due_date": payment["due_date"],
                        "investor": found_log["user_name"],
                        "item": found_log["item_name"],
                        "log_text": found_log["log_text"],
                        "detected_date": inv_payment["detected_date"]
                    })
                    logger.info(f"Found log for payment #{payment['payment_number']} from {found_log['user_name']}")
                else:
                    # No matching log found within the time window
                    inv_payment["detected_log_id"] = None
                    inv_payment["detected_log_text"] = None
                    inv_payment["detected_date"] = None
                    inv_payment["detection_status"] = "no_log_found"
        
        # Update payment schedule with detection info
        await db.stocks.update_one(
            {"_id": ObjectId(stock_id)},
            {"$set": {"payment_schedule": payment_schedule}}
        )
        
        return {
            "success": True,
            "detections_made": detections_made,
            "detected_logs": detected_logs,
            "message": f"Found {detections_made} matching log(s) within ±24 hours of due dates. Payments NOT marked as paid - please mark manually."
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking logs: {e}")
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
