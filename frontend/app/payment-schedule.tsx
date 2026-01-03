import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

interface InvestorPayment {
  user_id: number;
  user_name: string;
  split_percentage: number;
  amount: number;
  item_name?: string;
  paid: boolean;
  detected_log_id?: string;
  detected_log_text?: string;
  detected_date?: string;
  detection_status?: string;
}

interface Payment {
  payment_number: number;
  due_date: string;
  paid: boolean;
  paid_date?: string;
  investor_payments: InvestorPayment[];
  log_entry?: string;
}

interface SendMoneyModalData {
  visible: boolean;
  userId: number;
  userName: string;
  amount: number;
  paymentNumber: number;
}

export default function PaymentSchedule() {
  const params = useLocalSearchParams();
  const stockId = params.stockId as string;
  const stockName = params.stockName as string;
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [blankPayment, setBlankPayment] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detectingEvents, setDetectingEvents] = useState(false);
  const [sendMoneyModal, setSendMoneyModal] = useState<SendMoneyModalData>({
    visible: false,
    userId: 0,
    userName: '',
    amount: 0,
    paymentNumber: 0,
  });
  const [showPaidPayments, setShowPaidPayments] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stocks/${stockId}/payments`);
      setPayments(response.data.payments);
      setBlankPayment(response.data.blank_payment || 0);
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

  // Check if a date is today
  const isToday = (dateStr: string) => {
    const today = new Date();
    const dueDate = new Date(dateStr);
    return today.toDateString() === dueDate.toDateString();
  };

  // Open send money modal
  const openSendMoneyModal = (payment: Payment, inv: InvestorPayment) => {
    setSendMoneyModal({
      visible: true,
      userId: inv.user_id,
      userName: inv.user_name,
      amount: blankPayment,  // Use blank_payment (buddy payment) not payout_value
      paymentNumber: payment.payment_number,
    });
  };

  // Copy amount to clipboard and open Torn profile
  const handleCopyAndOpenProfile = async () => {
    const amountStr = sendMoneyModal.amount.toString();
    await Clipboard.setStringAsync(amountStr);
    
    // Open Torn profile in browser/TornPDA
    const profileUrl = `https://www.torn.com/profiles.php?XID=${sendMoneyModal.userId}`;
    Linking.openURL(profileUrl);
    
    // Close modal
    setSendMoneyModal({ ...sendMoneyModal, visible: false });
    
    if (Platform.OS === 'web') {
      alert(`Copied $${amountStr} to clipboard! Opening ${sendMoneyModal.userName}'s profile...`);
    } else {
      Alert.alert('Copied!', `$${amountStr} copied to clipboard. Opening ${sendMoneyModal.userName}'s profile...`);
    }
  };

  // Confirm and mark payment
  const handleConfirmPayment = async () => {
    try {
      const params = `?investor_user_id=${sendMoneyModal.userId}`;
      await axios.put(`${API_URL}/api/stocks/${stockId}/payments/${sendMoneyModal.paymentNumber}/mark-paid${params}`);
      setSendMoneyModal({ ...sendMoneyModal, visible: false });
      fetchPayments();
    } catch (error) {
      Alert.alert('Error', 'Failed to mark payment');
    }
  };

  const handleMarkPaid = async (paymentNumber: number, investorUserId?: number) => {
    try {
      const params = investorUserId ? `?investor_user_id=${investorUserId}` : '';
      const response = await axios.put(`${API_URL}/api/stocks/${stockId}/payments/${paymentNumber}/mark-paid${params}`);
      
      const action = response.data.paid ? 'marked as paid' : 'unmarked';
      if (Platform.OS === 'web') {
        alert(`Payment ${action}!`);
      } else {
        Alert.alert('Success', `Payment ${action}!`);
      }
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
          `Found ${detected.length} matching log(s):\n\n${logDetails}\n\nRemember: Mark payments as paid manually.`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Auto-Detection Complete',
          'No matching logs found within ±24 hours of due dates.\n\nMake sure:\n• Item name is set for the buddy\n• The buddy has sent you the item\n• The log is within 24hrs of the due date',
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

  // Split payments into paid and unpaid
  const paidPayments = payments.filter(p => p.paid);
  const unpaidPayments = payments.filter(p => !p.paid);
  
  // Sort unpaid by date (earliest first) and only show next 4
  const sortedUnpaidPayments = [...unpaidPayments]
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
    .slice(0, 4);

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
        <Text style={styles.headerTitle}>{stockName} Payments</Text>
        <TouchableOpacity 
          onPress={handleDetectEvents} 
          style={styles.detectButton}
          disabled={detectingEvents}
        >
          {detectingEvents ? (
            <ActivityIndicator size="small" color="#4caf50" />
          ) : (
            <Ionicons name="scan-outline" size={24} color="#4caf50" />
          )}
        </TouchableOpacity>
      </View>

      {/* Summary Stats */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Ionicons name="checkmark-circle" size={24} color="#4caf50" />
          <Text style={styles.summaryValue}>{paidPayments.length}</Text>
          <Text style={styles.summaryLabel}>Paid</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4caf50" />
        }
      >
        {/* Upcoming Payments Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="time-outline" size={18} color="#4caf50" /> Next {sortedUnpaidPayments.length} Payment{sortedUnpaidPayments.length !== 1 ? 's' : ''}
          </Text>
          
          {sortedUnpaidPayments.length === 0 ? (
            <View style={styles.emptySection}>
              <Ionicons name="checkmark-circle" size={48} color="#4caf50" />
              <Text style={styles.emptyText}>All payments received!</Text>
            </View>
          ) : (
            sortedUnpaidPayments.map((payment) => (
              <View key={payment.payment_number} style={[
                styles.paymentCard,
                isToday(payment.due_date) && styles.paymentCardDueToday
              ]}>
                <View style={styles.paymentHeader}>
                  <Text style={styles.paymentNumber}>Payment #{payment.payment_number}</Text>
                  <View style={[
                    styles.dueDateContainer,
                    isToday(payment.due_date) && styles.dueDateToday
                  ]}>
                    {isToday(payment.due_date) && (
                      <Text style={styles.todayBadge}>TODAY</Text>
                    )}
                    <Ionicons name="calendar-outline" size={16} color={isToday(payment.due_date) ? "#ffc107" : "#888"} />
                    <Text style={[styles.dueDate, isToday(payment.due_date) && styles.dueDateTextToday]}>
                      {formatDate(payment.due_date)}
                    </Text>
                  </View>
                </View>

                <View style={styles.investorsSection}>
                  {payment.investor_payments.map((inv, idx) => (
                    <View key={idx} style={styles.investorRowContainer}>
                      <View style={styles.investorRow}>
                        <View style={styles.investorInfo}>
                          <Text style={styles.investorName}>{inv.user_name}</Text>
                          <Text style={styles.investorAmount}>
                            {inv.item_name || 'Item'} - {formatMoney(inv.amount)}
                          </Text>
                        </View>
                        <View style={styles.investorStatus}>
                          {inv.detected_log_id && (
                            <Ionicons name="flash" size={16} color="#ffc107" style={styles.autoDetectedIcon} />
                          )}
                          {inv.paid ? (
                            <TouchableOpacity onPress={() => handleMarkPaid(payment.payment_number, inv.user_id)}>
                              <Ionicons name="checkmark-circle" size={24} color="#4caf50" />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity onPress={() => openSendMoneyModal(payment, inv)}>
                              <Ionicons name="ellipse-outline" size={24} color="#888" />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      {/* Show detection status */}
                      {inv.detection_status === 'found' && inv.detected_log_text && (
                        <View style={styles.detectionInfo}>
                          <Ionicons name="flash" size={14} color="#ffc107" />
                          <Text style={styles.detectionText}>
                            {inv.detected_log_text} ({inv.detected_date})
                          </Text>
                        </View>
                      )}
                      {inv.detection_status === 'no_log_found' && (
                        <View style={styles.detectionInfoMissing}>
                          <Ionicons name="alert-circle-outline" size={14} color="#888" />
                          <Text style={styles.noLogText}>No log found within ±24hrs</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Paid Payments Section (Collapsible) */}
        {paidPayments.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity 
              style={styles.collapsibleHeader}
              onPress={() => setShowPaidPayments(!showPaidPayments)}
            >
              <Text style={styles.sectionTitle}>
                <Ionicons name="checkmark-circle" size={18} color="#4caf50" /> Paid Payments ({paidPayments.length})
              </Text>
              <Ionicons 
                name={showPaidPayments ? "chevron-up" : "chevron-down"} 
                size={24} 
                color="#888" 
              />
            </TouchableOpacity>
            
            {showPaidPayments && (
              <View style={styles.paidPaymentsList}>
                {paidPayments.map((payment) => (
                  <View key={payment.payment_number} style={[styles.paymentCard, styles.paidPaymentCard]}>
                    <View style={styles.paymentHeader}>
                      <View style={styles.paidBadge}>
                        <Ionicons name="checkmark" size={14} color="#fff" />
                        <Text style={styles.paidBadgeText}>PAID</Text>
                      </View>
                      <Text style={styles.paymentNumberSmall}>#{payment.payment_number}</Text>
                      <Text style={styles.dueDateSmall}>{formatDate(payment.due_date)}</Text>
                    </View>

                    <View style={styles.investorsSection}>
                      {payment.investor_payments.map((inv, idx) => (
                        <View key={idx} style={styles.investorRowCompact}>
                          <Text style={styles.investorNameCompact}>{inv.user_name}</Text>
                          <Text style={styles.investorAmountCompact}>{formatMoney(inv.amount)}</Text>
                          <TouchableOpacity onPress={() => handleMarkPaid(payment.payment_number, inv.user_id)}>
                            <Ionicons name="close-circle-outline" size={20} color="#888" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Send Money Modal */}
      <Modal
        visible={sendMoneyModal.visible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSendMoneyModal({ ...sendMoneyModal, visible: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Payment</Text>
              <TouchableOpacity onPress={() => setSendMoneyModal({ ...sendMoneyModal, visible: false })}>
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Pay to:</Text>
              <Text style={styles.modalValue}>{sendMoneyModal.userName}</Text>
              
              <Text style={styles.modalLabel}>Amount:</Text>
              <Text style={styles.modalAmount}>${sendMoneyModal.amount.toLocaleString()}</Text>
              
              <TouchableOpacity 
                style={styles.sendMoneyButton}
                onPress={handleCopyAndOpenProfile}
              >
                <Ionicons name="open-outline" size={20} color="#fff" />
                <Text style={styles.sendMoneyButtonText}>Copy Amount & Open Profile</Text>
              </TouchableOpacity>
              
              <Text style={styles.modalHint}>
                Opens TornPDA/browser to {sendMoneyModal.userName}'s profile. Amount copied to clipboard for easy paste.
              </Text>

              <View style={styles.modalDivider} />

              <TouchableOpacity 
                style={styles.confirmButton}
                onPress={handleConfirmPayment}
              >
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.confirmButtonText}>Mark as Paid</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  detectButton: {
    padding: 8,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    justifyContent: 'center',
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4caf50',
    marginHorizontal: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#888',
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  emptySection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    marginTop: 12,
  },
  paymentCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  paymentCardDueToday: {
    backgroundColor: '#2e2a1a',
    borderColor: '#ffc107',
    borderWidth: 2,
  },
  paidPaymentCard: {
    backgroundColor: '#1a2e1a',
    borderColor: '#2d4a2d',
    opacity: 0.9,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  paymentNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  paymentNumberSmall: {
    fontSize: 14,
    color: '#888',
  },
  dueDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dueDateToday: {
    backgroundColor: 'rgba(255, 193, 7, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  todayBadge: {
    backgroundColor: '#ffc107',
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  dueDateTextToday: {
    color: '#ffc107',
    fontWeight: '600',
  },
  dueDate: {
    fontSize: 14,
    color: '#888',
    marginLeft: 4,
  },
  dueDateSmall: {
    fontSize: 13,
    color: '#888',
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4caf50',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  paidBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  investorsSection: {
    marginTop: 4,
  },
  investorRowContainer: {
    marginBottom: 8,
  },
  investorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  investorRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  investorInfo: {
    flex: 1,
  },
  investorName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  investorNameCompact: {
    fontSize: 14,
    color: '#ccc',
    flex: 1,
  },
  investorAmount: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  investorAmountCompact: {
    fontSize: 13,
    color: '#4caf50',
    marginRight: 12,
  },
  investorStatus: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  autoDetectedIcon: {
    marginRight: 4,
  },
  detectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 6,
  },
  detectionInfoMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(136, 136, 136, 0.1)',
    borderRadius: 6,
  },
  detectionText: {
    fontSize: 12,
    color: '#ffc107',
    marginLeft: 6,
    flex: 1,
  },
  noLogText: {
    fontSize: 12,
    color: '#888',
    marginLeft: 6,
    fontStyle: 'italic',
  },
  paidPaymentsList: {
    marginTop: 8,
  },
  bottomPadding: {
    height: 40,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalBody: {
    padding: 20,
  },
  modalLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  modalValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  modalAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4caf50',
    marginBottom: 20,
  },
  sendMoneyButton: {
    backgroundColor: '#2196f3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  sendMoneyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalHint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 16,
  },
  confirmButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
