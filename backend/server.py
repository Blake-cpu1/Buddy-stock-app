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

# Helper function to get API key from database
async def get_api_key() -> Optional[str]:
    """Retrieve the stored API key from database"""
    settings = await db.settings.find_one({"type": "api_key"})
    if settings:
        return settings.get("key")
    return None

# Helper function to make Torn API requests
async def fetch_torn_api(endpoint: str, selections: str) -> Dict[str, Any]:
    """Make a request to Torn API"""
    api_key = await get_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key not configured. Please set your Torn API key in settings.")
    
    url = f"{TORN_API_BASE}/{endpoint}?selections={selections}&key={api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
            
            # Check for Torn API errors
            if "error" in data:
                error_code = data["error"].get("code")
                error_msg = data["error"].get("error", "Unknown error")
                logger.error(f"Torn API Error {error_code}: {error_msg}")
                raise HTTPException(status_code=400, detail=f"Torn API Error: {error_msg}")
            
            return data
    except httpx.HTTPError as e:
        logger.error(f"HTTP error occurred: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch data from Torn API: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Torn Dashboard API", "status": "running"}

@api_router.post("/settings/api-key")
async def update_api_key(data: APIKeyUpdate):
    """Update the Torn API key"""
    try:
        # Validate the API key by making a test request
        url = f"{TORN_API_BASE}/user/?selections=basic&key={data.api_key}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            result = response.json()
            
            if "error" in result:
                error_msg = result["error"].get("error", "Invalid API key")
                raise HTTPException(status_code=400, detail=f"Invalid API key: {error_msg}")
        
        # Store the API key in database
        await db.settings.update_one(
            {"type": "api_key"},
            {"$set": {"key": data.api_key, "updated_at": datetime.utcnow()}},
            upsert=True
        )
        
        logger.info("API key updated successfully")
        return {"success": True, "message": "API key saved successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating API key: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/settings/api-key", response_model=APIKeyResponse)
async def get_api_key_status():
    """Check if API key is configured"""
    api_key = await get_api_key()
    if api_key:
        # Return first 4 and last 4 characters for preview
        preview = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "****"
        return APIKeyResponse(has_key=True, key_preview=preview)
    return APIKeyResponse(has_key=False)

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
