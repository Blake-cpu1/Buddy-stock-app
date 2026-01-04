import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

const TRAVEL_NOTIFICATION_TASK = 'TRAVEL_NOTIFICATION_TASK';
const TRAVEL_NOTIFICATION_ID = 'travel-status';

// Country flags mapping
const COUNTRY_FLAGS: { [key: string]: string } = {
  'Mexico': '🇲🇽',
  'Cayman Islands': '🇰🇾',
  'Canada': '🇨🇦',
  'Hawaii': '🇺🇸',
  'United Kingdom': '🇬🇧',
  'Argentina': '🇦🇷',
  'Switzerland': '🇨🇭',
  'Japan': '🇯🇵',
  'China': '🇨🇳',
  'UAE': '🇦🇪',
  'South Africa': '🇿🇦',
  'Torn': '🏠',
};

interface TravelData {
  destination: string;
  timestamp: number;
  departed: number;
  time_left: number;
}

// Format seconds to human readable time
const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return 'Arrived';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Calculate progress percentage
const calculateProgress = (travel: TravelData): number => {
  const totalTime = travel.timestamp - travel.departed;
  const elapsed = totalTime - travel.time_left;
  return Math.max(0, Math.min(100, (elapsed / totalTime) * 100));
};

// Show or update travel notification
export const showTravelNotification = async (travel: TravelData): Promise<void> => {
  if (!travel || travel.time_left <= 0 || travel.destination === 'Torn') {
    // Dismiss notification if not traveling
    await dismissTravelNotification();
    return;
  }

  const flag = COUNTRY_FLAGS[travel.destination] || '🌍';
  const duration = formatDuration(travel.time_left);
  const arrivalTime = new Date(travel.timestamp * 1000).toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  const progress = calculateProgress(travel);

  try {
    // Cancel existing notification first
    await Notifications.dismissNotificationAsync(TRAVEL_NOTIFICATION_ID);
    
    // Schedule new notification (immediate)
    await Notifications.scheduleNotificationAsync({
      identifier: TRAVEL_NOTIFICATION_ID,
      content: {
        title: `${flag} Flying to ${travel.destination}`,
        body: `Arriving in: ${duration} (ETA ${arrivalTime} LT)`,
        data: { 
          type: 'travel',
          destination: travel.destination,
          arrival: travel.timestamp 
        },
        sound: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
        sticky: true, // Makes it persistent (Android)
        autoDismiss: false,
        ...(Platform.OS === 'android' && {
          categoryIdentifier: 'travel',
          // Progress bar for Android
          progress: progress / 100,
        }),
      },
      trigger: null, // Show immediately
    });
  } catch (error) {
    console.error('Error showing travel notification:', error);
  }
};

// Dismiss travel notification
export const dismissTravelNotification = async (): Promise<void> => {
  try {
    await Notifications.dismissNotificationAsync(TRAVEL_NOTIFICATION_ID);
  } catch (error) {
    console.error('Error dismissing travel notification:', error);
  }
};

// Setup notification channel for Android
export const setupTravelNotificationChannel = async (): Promise<void> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('travel', {
      name: 'Travel Status',
      description: 'Shows your current travel status in Torn',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      enableVibrate: false,
      sound: null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });
  }
};

// Check travel status and update notification
export const checkAndUpdateTravelNotification = async (apiUrl: string): Promise<void> => {
  try {
    const response = await fetch(`${apiUrl}/api/user/dashboard`);
    if (!response.ok) return;
    
    const data = await response.json();
    const travel = data.travel as TravelData;
    
    if (travel && travel.time_left > 0 && travel.destination !== 'Torn') {
      await showTravelNotification(travel);
    } else {
      await dismissTravelNotification();
    }
  } catch (error) {
    console.error('Error checking travel status:', error);
  }
};

// Define background task for updating travel notification
TaskManager.defineTask(TRAVEL_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background task error:', error);
    return;
  }
  
  // This will be called periodically by the system
  // Note: Background fetch intervals are controlled by the OS
  console.log('Travel notification background task executed');
});

// Export task name for registration
export const TRAVEL_TASK_NAME = TRAVEL_NOTIFICATION_TASK;
