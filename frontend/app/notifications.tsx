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
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

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
  const [scheduling, setScheduling] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const router = useRouter();
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  useEffect(() => {
    checkPermissions();
    getScheduledNotifications();

    // Listen for notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);
      // Navigate to stock investments when notification is tapped
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

  const checkPermissions = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionStatus(status);
      setNotificationsEnabled(status === 'granted');
    } catch (error) {
      console.error('Error checking permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestPermissions = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Notice', 'Push notifications are not fully supported on web. Please use the mobile app.');
        return;
      }

      if (!Device.isDevice) {
        Alert.alert('Notice', 'Push notifications only work on physical devices, not simulators.');
        return;
      }

      const { status } = await Notifications.requestPermissionsAsync();
      setPermissionStatus(status);
      setNotificationsEnabled(status === 'granted');

      if (status === 'granted') {
        Alert.alert('Success', 'Notifications enabled! You will receive reminders for payment due dates.');
      } else {
        Alert.alert('Permission Denied', 'Please enable notifications in your device settings.');
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      Alert.alert('Error', 'Failed to request notification permissions');
    }
  };

  const getScheduledNotifications = async () => {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      setScheduledCount(scheduled.length);
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
    }
  };

  const sendTestNotification = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Web Notice', 'Push notifications are limited on web. This test will show an alert instead.');
        return;
      }

      if (permissionStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please enable notifications first.');
        return;
      }

      // Use presentNotificationAsync for immediate notification
      await Notifications.presentNotificationAsync({
        title: '🔔 Test Notification',
        body: 'This is a test! Your payment reminders are working.',
        data: { type: 'test' },
      });

      Alert.alert('Test Sent', 'You should see a test notification!');
    } catch (error) {
      console.error('Error sending test notification:', error);
      // Try alternative method
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🔔 Test Notification',
            body: 'This is a test! Your payment reminders are working.',
            data: { type: 'test' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
          },
        });
        Alert.alert('Test Sent', 'You should receive a test notification in 1 second!');
      } catch (err) {
        console.error('Alternative method also failed:', err);
        Alert.alert('Error', 'Failed to send test notification. This feature works best on physical devices.');
      }
    }
  };

  const schedulePaymentNotifications = async () => {
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Web Notice', 'Scheduled notifications are not supported on web. Please use the mobile app.');
        return;
      }

      if (permissionStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please enable notifications first.');
        return;
      }

      setScheduling(true);

      // Cancel all existing notifications first
      await Notifications.cancelAllScheduledNotificationsAsync();

      // Fetch all stocks and their payment schedules
      const stocksResponse = await axios.get(`${API_URL}/api/stocks`);
      const stocks = stocksResponse.data.stocks;

      let notificationsScheduled = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Collect all due dates for the next 30 days
      const dueDatesMap: { [key: string]: string[] } = {}; // date string -> stock names

      for (const stock of stocks) {
        // Fetch payment schedule for each stock
        const paymentsResponse = await axios.get(`${API_URL}/api/stocks/${stock.id}/payments`);
        const payments = paymentsResponse.data.payments;

        // Get unpaid payments in the next 30 days
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

      // Schedule daily 2 PM notifications for the next 30 days
      for (let i = 0; i <= 30; i++) {
        const notifDate = new Date(today);
        notifDate.setDate(notifDate.getDate() + i);
        notifDate.setHours(14, 0, 0, 0); // 2 PM

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
      Alert.alert(
        'Notifications Scheduled',
        `${notificationsScheduled} daily reminder(s) scheduled for 2 PM over the next 30 days.\n\nYou'll be notified about due payments or if there are none that day.`
      );
    } catch (error) {
      console.error('Error scheduling notifications:', error);
      Alert.alert('Error', 'Failed to schedule notifications');
    } finally {
      setScheduling(false);
      getScheduledNotifications();
    }
  };

  const clearAllNotifications = async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      setScheduledCount(0);
      Alert.alert('Cleared', 'All scheduled notifications have been removed.');
    } catch (error) {
      console.error('Error clearing notifications:', error);
      Alert.alert('Error', 'Failed to clear notifications');
    }
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
        {/* Permission Status Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="notifications" size={24} color="#4caf50" />
            <Text style={styles.cardTitle}>Notification Status</Text>
          </View>
          
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Permission:</Text>
            <View style={[
              styles.statusBadge,
              permissionStatus === 'granted' ? styles.statusGranted : styles.statusDenied
            ]}>
              <Text style={styles.statusText}>
                {permissionStatus === 'granted' ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Scheduled Reminders:</Text>
            <Text style={styles.statusValue}>{scheduledCount}</Text>
          </View>

          {permissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.enableButton} onPress={requestPermissions}>
              <Ionicons name="notifications-outline" size={20} color="#fff" />
              <Text style={styles.enableButtonText}>Enable Notifications</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Test Notification Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="flask" size={24} color="#2196f3" />
            <Text style={styles.cardTitle}>Test Notification</Text>
          </View>
          
          <Text style={styles.cardDescription}>
            Send a test notification to verify everything is working correctly.
          </Text>

          <TouchableOpacity 
            style={[styles.actionButton, styles.testButton]} 
            onPress={sendTestNotification}
          >
            <Ionicons name="send" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Send Test Notification</Text>
          </TouchableOpacity>
        </View>

        {/* Schedule Notifications Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="calendar" size={24} color="#ffc107" />
            <Text style={styles.cardTitle}>Daily Payment Reminders</Text>
          </View>
          
          <Text style={styles.cardDescription}>
            Schedule daily notifications at 2 PM for the next 30 days.{'\n\n'}
            • If payments are due: Shows which investments need payment{'\n'}
            • If no payments: "No payments due today!"
          </Text>

          <TouchableOpacity 
            style={[styles.actionButton, styles.scheduleButton]} 
            onPress={schedulePaymentNotifications}
            disabled={scheduling}
          >
            {scheduling ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="alarm" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Schedule Daily Reminders</Text>
              </>
            )}
          </TouchableOpacity>

          {scheduledCount > 0 && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.clearButton]} 
              onPress={clearAllNotifications}
            >
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.actionButtonText}>Clear All Reminders</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={20} color="#888" />
          <Text style={styles.infoText}>
            Notifications work best on physical devices with the Expo Go app or a standalone build. Web has limited support.
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 14,
    color: '#888',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusGranted: {
    backgroundColor: '#1b5e20',
  },
  statusDenied: {
    backgroundColor: '#b71c1c',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  enableButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  enableButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  testButton: {
    backgroundColor: '#2196f3',
  },
  scheduleButton: {
    backgroundColor: '#ffc107',
  },
  clearButton: {
    backgroundColor: '#666',
    marginTop: 12,
  },
  actionButtonText: {
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
