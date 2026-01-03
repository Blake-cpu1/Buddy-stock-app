import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

interface InvestorPayment {
  user_id: number;
  user_name: string;
  split_percentage: number;
  amount: number;
  item_name?: string;
  paid: boolean;
}

interface Payment {
  payment_number: number;
  due_date: string;
  paid: boolean;
  paid_date?: string;
  investor_payments: InvestorPayment[];
  log_entry?: string;
}

export default function PaymentSchedule() {
  const params = useLocalSearchParams();
  const stockId = params.stockId as string;
  const stockName = params.stockName as string;
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detectingEvents, setDetectingEvents] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stocks/${stockId}/payments`);
      setPayments(response.data.payments);
    } catch (error: any) {
      console.error('Error fetching payments:', error);
      Alert.alert('Error', 'Failed to load payment schedule');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPayments();
  }, []);

  const handleMarkPaid = async (paymentNumber: number, investorUserId?: number) => {
    try {
      const params = investorUserId ? `?investor_user_id=${investorUserId}` : '';
      const response = await axios.put(`${API_URL}/api/stocks/${stockId}/payments/${paymentNumber}/mark-paid${params}`);
      
      const action = response.data.paid ? 'marked as paid' : 'unmarked';
      Alert.alert('Success', `Payment ${action}!`);
      fetchPayments();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to toggle payment status');
    }
  };

  const handleDetectEvents = async () => {
    setDetectingEvents(true);
    try {
      const response = await axios.post(`${API_URL}/api/stocks/${stockId}/payments/check-events`);
      
      const detected = response.data.detected_logs || [];
      if (detected.length > 0) {
        const logDetails = detected.map((d: any) => 
          `Payment #${d.payment_number}: ${d.investor} - ${d.item}`
        ).join('\n');
        
        Alert.alert(
          'Auto-Detection Complete',
          `Found ${detected.length} payment(s):\n\n${logDetails}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Auto-Detection Complete',
          'No new payments detected in your logs.\n\nMake sure:\n• Item name is set for each investor\n• The investor has sent you the item\n• The logs show the transaction',
          [{ text: 'OK' }]
        );
      }
      
      fetchPayments();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to check logs';
      Alert.alert('Error', errorMsg);
    } finally {
      setDetectingEvents(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return dateStr;
    }
  };

  const formatMoney = (amount: number) => {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4caf50" />
        <Text style={styles.loadingText}>Loading payment schedule...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>Payment Schedule</Text>
          <Text style={styles.headerSubtitle}>{stockName}</Text>
        </View>
        <TouchableOpacity onPress={handleDetectEvents} style={styles.detectButton} disabled={detectingEvents}>
          {detectingEvents ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="scan" size={28} color="#4caf50" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4caf50" />}
      >
        <View style={styles.listContainer}>
          {payments.map((payment) => (
            <View key={payment.payment_number} style={[
              styles.paymentCard,
              payment.paid && styles.paymentCardPaid
            ]}>
              <View style={styles.paymentHeader}>
                <View>
                  <Text style={styles.paymentNumber}>Payment #{payment.payment_number}</Text>
                  <Text style={styles.paymentDate}>Due: {formatDate(payment.due_date)}</Text>
                </View>
                {payment.paid ? (
                  <TouchableOpacity 
                    style={styles.unmarkButton}
                    onPress={() => handleMarkPaid(payment.payment_number)}
                  >
                    <Ionicons name="close-circle-outline" size={20} color="#fff" />
                    <Text style={styles.unmarkButtonText}>Unmark</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={styles.markPaidButton}
                    onPress={() => handleMarkPaid(payment.payment_number)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text style={styles.markPaidButtonText}>Mark Paid</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.investorsSection}>
                <Text style={styles.investorsTitle}>Investors:</Text>
                {payment.investor_payments.map((inv, idx) => (
                  <View key={idx} style={styles.investorRow}>
                    <View style={styles.investorInfo}>
                      <Text style={styles.investorName}>
                        {inv.user_name} ({inv.split_percentage}%)
                      </Text>
                      <Text style={styles.investorAmount}>
                        {formatMoney(inv.amount)}
                        {inv.item_name && ` - ${inv.item_name}`}
                      </Text>
                    </View>
                    <View style={styles.investorStatus}>
                      {inv.paid ? (
                        <Ionicons name="checkmark-circle" size={20} color="#4caf50" />
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleMarkPaid(payment.payment_number, inv.user_id)}
                        >
                          <Ionicons name="ellipse-outline" size={20} color="#888" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </View>

              {payment.log_entry && (
                <View style={styles.logEntry}>
                  <Text style={styles.logText}>{payment.log_entry}</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#1a1a1a',
  },
  backButton: {
    padding: 8,
  },
  headerTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 2,
  },
  detectButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#aaa',
    marginTop: 10,
    fontSize: 16,
  },
  listContainer: {
    padding: 20,
  },
  paymentCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
  },
  paymentCardPaid: {
    borderLeftColor: '#4caf50',
    opacity: 0.7,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  paymentNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  paymentDate: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paidText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
    marginLeft: 6,
  },
  markPaidButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  markPaidButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  investorsSection: {
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 12,
  },
  investorsTitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  investorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#252525',
    padding: 12,
    borderRadius: 8,
  },
  investorInfo: {
    flex: 1,
  },
  investorName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  investorAmount: {
    fontSize: 14,
    color: '#4caf50',
  },
  investorStatus: {
    marginLeft: 12,
  },
  logEntry: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#252525',
    borderRadius: 6,
  },
  logText: {
    fontSize: 13,
    color: '#aaa',
    fontStyle: 'italic',
  },
});
