import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Switch,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

const STORAGE_KEYS = {
  NOTIFICATIONS_ENABLED: 'notifications_enabled',
  NOTIFICATION_HOUR: 'notification_hour',
  NOTIFICATION_MINUTE: 'notification_minute',
};

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function NotificationsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>('unknown');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [notificationHour, setNotificationHour] = useState('14');
  const [notificationMinute, setNotificationMinute] = useState('00');
  const router = useRouter();
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  useEffect(() => {
    loadSettings();

    // Listen for notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);
      router.push('/buddy-stocks');
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  const loadSettings = async () => {
    try {
      // Check permissions
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionStatus(status);

      // Load saved settings
      const enabled = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED);
      const hour = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATION_HOUR);
      const minute = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATION_MINUTE);

      if (enabled !== null) setNotificationsEnabled(enabled === 'true');
      if (hour !== null) setNotificationHour(hour);
      if (minute !== null) setNotificationMinute(minute);

      // Get scheduled notifications count
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      setScheduledCount(scheduled.length);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestPermissions = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Notice', 'Push notifications are not fully supported on web. Please use the mobile app.');
        return false;
      }

      if (!Device.isDevice) {
        Alert.alert('Notice', 'Push notifications only work on physical devices, not simulators.');
        return false;
      }

      const { status } = await Notifications.requestPermissionsAsync();
      setPermissionStatus(status);

      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable notifications in your device settings.');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return false;
    }
  };

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      // Turning ON - request permissions first
      const granted = await requestPermissions();
      if (!granted) return;
    }

    setNotificationsEnabled(value);
    await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED, value.toString());

    if (value) {
      // Schedule notifications
      await scheduleNotifications();
    } else {
      // Cancel all notifications
      await Notifications.cancelAllScheduledNotificationsAsync();
      setScheduledCount(0);
    }
  };

  const handleTimeChange = async () => {
    // Validate time
    const hour = parseInt(notificationHour);
    const minute = parseInt(notificationMinute);

    if (isNaN(hour) || hour < 0 || hour > 23) {
      Alert.alert('Invalid Time', 'Hour must be between 0 and 23');
      return;
    }
    if (isNaN(minute) || minute < 0 || minute > 59) {
      Alert.alert('Invalid Time', 'Minute must be between 0 and 59');
      return;
    }

    // Save settings
    await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATION_HOUR, notificationHour);
    await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATION_MINUTE, notificationMinute);

    // Reschedule if enabled
    if (notificationsEnabled) {
      await scheduleNotifications();
    }

    Alert.alert('Saved', `Notification time set to ${notificationHour.padStart(2, '0')}:${notificationMinute.padStart(2, '0')}`);
  };

  const scheduleNotifications = async () => {
    try {
      setSaving(true);

      // Cancel existing notifications
      await Notifications.cancelAllScheduledNotificationsAsync();

      if (Platform.OS === 'web') {
        setScheduledCount(0);
        return;
      }

      // Fetch all stocks and their payment schedules
      const stocksResponse = await axios.get(`${API_URL}/api/stocks`);
      const stocks = stocksResponse.data.stocks;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Collect all due dates for the next 30 days
      const dueDatesMap: { [key: string]: string[] } = {};

      for (const stock of stocks) {
        const paymentsResponse = await axios.get(`${API_URL}/api/stocks/${stock.id}/payments`);
        const payments = paymentsResponse.data.payments;

        for (const payment of payments) {
          if (payment.paid) continue;

          const dueDate = new Date(payment.due_date);
          const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays >= 0 && diffDays <= 30) {
            const dateKey = payment.due_date;
            if (!dueDatesMap[dateKey]) {
              dueDatesMap[dateKey] = [];
            }
            dueDatesMap[dateKey].push(stock.stock_name);
          }
        }
      }

      const hour = parseInt(notificationHour);
      const minute = parseInt(notificationMinute);
      let notificationsScheduled = 0;

      // Schedule daily notifications for the next 30 days
      for (let i = 0; i <= 30; i++) {
        const notifDate = new Date(today);
        notifDate.setDate(notifDate.getDate() + i);
        notifDate.setHours(hour, minute, 0, 0);

        // Skip if the date is in the past
        if (notifDate.getTime() <= Date.now()) continue;

        const dateKey = notifDate.toISOString().split('T')[0];
        const stocksDueToday = dueDatesMap[dateKey] || [];

        let title: string;
        let body: string;

        if (stocksDueToday.length > 0) {
          title = `💰 ${stocksDueToday.length} Payment${stocksDueToday.length > 1 ? 's' : ''} Due Today!`;
          body = stocksDueToday.join(', ');
        } else {
          title = '✅ No Payments Due Today';
          body = 'All clear! No investment payments due today.';
        }

        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title,
              body,
              data: { type: 'daily', date: dateKey },
              sound: true,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: notifDate,
            },
          });
          notificationsScheduled++;
        } catch (err) {
          console.error(`Failed to schedule notification for ${dateKey}:`, err);
        }
      }

      setScheduledCount(notificationsScheduled);
    } catch (error) {
      console.error('Error scheduling notifications:', error);
    } finally {
      setSaving(false);
    }
  };

  const sendTestNotification = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Web Notice', 'Push notifications are limited on web.');
        return;
      }

      if (permissionStatus !== 'granted') {
        const granted = await requestPermissions();
        if (!granted) return;
      }

      await Notifications.presentNotificationAsync({
        title: '🔔 Test Notification',
        body: 'This is a test! Your payment reminders are working.',
        data: { type: 'test' },
      });
    } catch (error) {
      console.error('Error sending test notification:', error);
      Alert.alert('Error', 'Failed to send test notification. This feature works best on physical devices.');
    }
  };

  const formatTime = () => {
    const hour = parseInt(notificationHour) || 0;
    const minute = parseInt(notificationMinute) || 0;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4caf50" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Main Toggle Card */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Ionicons name="notifications" size={28} color={notificationsEnabled ? "#4caf50" : "#888"} />
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleTitle}>Daily Reminders</Text>
                <Text style={styles.toggleSubtitle}>
                  {notificationsEnabled ? `Active at ${formatTime()}` : 'Disabled'}
                </Text>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: '#333', true: '#4caf50' }}
              thumbColor={notificationsEnabled ? '#fff' : '#888'}
            />
          </View>

          {notificationsEnabled && (
            <View style={styles.statusInfo}>
              <Ionicons name="checkmark-circle" size={16} color="#4caf50" />
              <Text style={styles.statusText}>{scheduledCount} reminders scheduled</Text>
            </View>
          )}
        </View>

        {/* Time Picker Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="time" size={24} color="#ffc107" />
            <Text style={styles.cardTitle}>Notification Time</Text>
          </View>

          <Text style={styles.cardDescription}>
            Set the time you want to receive daily payment reminders.
          </Text>

          <View style={styles.timePickerRow}>
            <View style={styles.timeInputGroup}>
              <Text style={styles.timeLabel}>Hour (0-23)</Text>
              <TextInput
                style={styles.timeInput}
                value={notificationHour}
                onChangeText={setNotificationHour}
                keyboardType="numeric"
                maxLength={2}
                placeholder="14"
                placeholderTextColor="#666"
              />
            </View>
            <Text style={styles.timeSeparator}>:</Text>
            <View style={styles.timeInputGroup}>
              <Text style={styles.timeLabel}>Minute</Text>
              <TextInput
                style={styles.timeInput}
                value={notificationMinute}
                onChangeText={setNotificationMinute}
                keyboardType="numeric"
                maxLength={2}
                placeholder="00"
                placeholderTextColor="#666"
              />
            </View>
          </View>

          <Text style={styles.timePreview}>Preview: {formatTime()}</Text>

          <TouchableOpacity style={styles.saveTimeButton} onPress={handleTimeChange}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text style={styles.saveTimeButtonText}>Save Time</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Test Notification Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="flask" size={24} color="#2196f3" />
            <Text style={styles.cardTitle}>Test Notification</Text>
          </View>

          <Text style={styles.cardDescription}>
            Send a test notification to verify everything is working.
          </Text>

          <TouchableOpacity style={styles.testButton} onPress={sendTestNotification}>
            <Ionicons name="send" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Send Test</Text>
          </TouchableOpacity>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color="#888" />
          <Text style={styles.infoText}>
            When enabled, you'll receive a notification daily at your set time showing which payments are due (or "No payments due" if none).
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  loadingText: {
    marginTop: 12,
    color: '#888',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 50,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toggleTextContainer: {
    marginLeft: 12,
  },
  toggleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  toggleSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  statusInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  statusText: {
    fontSize: 14,
    color: '#4caf50',
    marginLeft: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 10,
  },
  cardDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    lineHeight: 20,
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  timeInputGroup: {
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  timeInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    width: 80,
    height: 50,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    borderWidth: 1,
    borderColor: '#444',
  },
  timeSeparator: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginHorizontal: 12,
    marginTop: 16,
  },
  timePreview: {
    textAlign: 'center',
    fontSize: 16,
    color: '#ffc107',
    marginBottom: 16,
  },
  saveTimeButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveTimeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  testButton: {
    backgroundColor: '#2196f3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#888',
    marginLeft: 8,
    lineHeight: 18,
  },
});
