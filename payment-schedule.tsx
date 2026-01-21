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
  Platform,
  Modal,
  Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';

interface Investor {
  user_id: number;
  user_name?: string;
  split_percentage: number;
  item_name?: string;
  item_id?: number;
  market_value?: number;
  items?: Array<{ name: string; id: number; value: number }>;
}

interface PaymentsStateEntry {
  paid: boolean;
  paid_date?: string;
  detected_log_id?: string;
  detected_log_text?: string;
  detected_date?: string;
  detection_status?: string;
}

interface Stock {
  id: string;
  stock_name: string;
  start_date: string;
  days_per_payout: number;
  total_cost: number;
  payout_value: number;
  blank_payment: number;
  investors: Investor[];
  total_payouts: number;
  payouts_received: number;
  total_received: number;
  blake_total: number;
  next_payout_due?: string;
  days_since_start: number;
  annualized_roi: number;
  payments_state?: { [paymentNumber: string]: PaymentsStateEntry };
}

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

  const [stock, setStock] = useState<Stock | null>(null);
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
    fetchStockAndPayments();
  }, []);

  const fetchStockAndPayments = async () => {
    try {
      setLoading(true);
      const json = await AsyncStorage.getItem('buddy_stocks');
      const allStocks: Stock[] = json ? JSON.parse(json) : [];
      const found = allStocks.find((s) => s.id === stockId);
      if (!found) {
        Alert.alert('Error', 'Stock not found');
        setStock(null);
        setPayments([]);
        return;
      }

      setStock(found);
      setBlankPayment(found.blank_payment || 0);
      const generated = generatePayments(found);
      setPayments(generated);
    } catch (error) {
      console.error('Error loading payments from local storage:', error);
      Alert.alert('Error', 'Failed to load payment schedule');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

const generatePayments = (s: Stock): Payment[] => {
  const result: Payment[] = [];
  const start = new Date(s.start_date);
  if (isNaN(start.getTime()) || s.days_per_payout <= 0) return result;

  const maxPayments = 200; // guard: "indefinite" in practice
  const intervalMs = s.days_per_payout * 24 * 60 * 60 * 1000;
  const investor = s.investors[0];

  for (let i = 0; i < maxPayments; i++) {
    const paymentNumber = i + 1;

    // ⭐ FIXED: Payment #1 = start + days_per_payout
    // Payment #2 = start + 2 * days_per_payout
    // Payment #3 = start + 3 * days_per_payout
    const dueDate = new Date(start.getTime() + (i + 1) * intervalMs);

    const stateEntry = s.payments_state?.[String(paymentNumber)];

    const invPayment: InvestorPayment = {
      user_id: investor?.user_id ?? 0,
      user_name: investor?.user_name || s.stock_name,
      split_percentage: investor?.split_percentage ?? 100,
      amount: paymentNumber === 1 ? s.blank_payment : s.payout_value,
      item_name: investor?.item_name,
      paid: stateEntry?.paid ?? false,
      detected_log_id: stateEntry?.detected_log_id,
      detected_log_text: stateEntry?.detected_log_text,
      detected_date: stateEntry?.detected_date,
      detection_status: stateEntry?.detection_status,
    };

    const payment: Payment = {
      payment_number: paymentNumber,
      due_date: dueDate.toISOString(),
      paid: invPayment.paid,
      paid_date: stateEntry?.paid_date,
      investor_payments: [invPayment],
    };

    result.push(payment);
  }

  return result;
};

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStockAndPayments();
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
      amount: blankPayment,
      paymentNumber: payment.payment_number,
    });
  };

  // Copy amount to clipboard and open Torn profile
  const handleCopyAndOpenProfile = async () => {
    const amountStr = sendMoneyModal.amount.toString();
    await Clipboard.setStringAsync(amountStr);

    const profileUrl = `https://www.torn.com/profiles.php?XID=${sendMoneyModal.userId}`;
    Linking.openURL(profileUrl);

    setSendMoneyModal({ ...sendMoneyModal, visible: false });

    if (Platform.OS === 'web') {
      alert(
        `Copied $${amountStr} to clipboard! Opening ${sendMoneyModal.userName}'s profile...`
      );
    } else {
      Alert.alert(
        'Copied!',
        `$${amountStr} copied to clipboard. Opening ${sendMoneyModal.userName}'s profile...`
      );
    }
  };

  // Update local payment state for a given payment
  const updatePaymentState = async (
    paymentNumber: number,
    updater: (prev: PaymentsStateEntry | undefined) => PaymentsStateEntry
  ) => {
    try {
      const json = await AsyncStorage.getItem('buddy_stocks');
      const allStocks: Stock[] = json ? JSON.parse(json) : [];
      const idx = allStocks.findIndex((s) => s.id === stockId);
      if (idx === -1) {
        Alert.alert('Error', 'Stock not found');
        return;
      }

      const current = allStocks[idx];
      const payments_state = { ...(current.payments_state || {}) };
      const key = String(paymentNumber);
      const prev = payments_state[key];
      payments_state[key] = updater(prev);

      const updatedStock: Stock = { ...current, payments_state };
      allStocks[idx] = updatedStock;

      await AsyncStorage.setItem('buddy_stocks', JSON.stringify(allStocks));
      setStock(updatedStock);
      setPayments(generatePayments(updatedStock));
    } catch (error) {
      console.error('Error updating payment state:', error);
      Alert.alert('Error', 'Failed to update payment');
    }
  };

  // Confirm and mark payment (from modal) as paid
const handleConfirmPayment = async () => {
  if (!stock) return;

  const paymentNumber = sendMoneyModal.paymentNumber;
  const payment = payments.find((p) => p.payment_number === paymentNumber);
  if (!payment) return;

  const investor = stock.investors[0];
  const items = investor?.items || [];
  const buddyName = (investor.user_name || stock.stock_name || 'your buddy').toLowerCase();
  const itemNames = items.map((i) => i.name.toLowerCase());
  const windowMs = 48 * 60 * 60 * 1000;
  const due = new Date(payment.due_date);

  let detected_log_text: string | undefined = undefined;
  let detected_date: string | undefined = undefined;

  try {
    const key = await SecureStore.getItemAsync('torn_api_key');
    if (key) {
      const response = await axios.get(
        `https://api.torn.com/user/?selections=events&key=${key}`
      );

      const events = Object.values(response.data?.events || {});

      // ⭐ FIX: find ALL matching events, not just one
      const matchingEvents = events.filter((ev: any) => {
        if (!ev.event) return false;

        const text = ev.event
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .toLowerCase();

        if (!text.includes(buddyName)) return false;

        const matchedItem = itemNames.find((name) => text.includes(name));
        if (!matchedItem) return false;

        const ts = new Date(ev.timestamp * 1000);
        const diff = Math.abs(ts.getTime() - due.getTime());
        if (diff > windowMs) return false;

        return true;
      });

      if (matchingEvents.length > 0) {
        const lines: string[] = [];

        matchingEvents.forEach((ev: any) => {
          const sender = extractSenderName(ev.event);
          const cleanText = ev.event
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase();

          const matchedItems = items
            .filter((i) => cleanText.includes(i.name.toLowerCase()))
            .map((i) => i.name);

          const ts = new Date(ev.timestamp * 1000);
          const time = ts.toLocaleTimeString();
          const date = ts.toLocaleDateString();

          matchedItems.forEach((name) => {
            lines.push(`${time} - ${date} ${sender} sent a ${name} to you`);
          });
        });

        detected_log_text = lines.join('\n');
        detected_date = new Date(matchingEvents[0].timestamp * 1000).toISOString();
      }
    }
  } catch (error) {
    console.warn('Event log lookup failed during confirm:', error);
  }

  await updatePaymentState(paymentNumber, (prev) => ({
    paid: true,
    paid_date: new Date().toISOString(),
    amount: paymentNumber === 0 ? stock.blank_payment : stock.payout_value,
    detected_log_id: prev?.detected_log_id,
    detected_log_text: detected_log_text ?? prev?.detected_log_text,
    detected_date: detected_date ?? prev?.detected_date,
    detection_status: detected_log_text ? 'found' : prev?.detection_status,
  }));

  setSendMoneyModal({ ...sendMoneyModal, visible: false });
};

  // Toggle paid/unpaid from list
  const handleMarkPaid = async (paymentNumber: number, _investorUserId?: number) => {
    const current = payments.find((p) => p.payment_number === paymentNumber);
    const currentlyPaid = current?.paid ?? false;

await updatePaymentState(paymentNumber, (prev) => ({
  paid: !currentlyPaid,
  paid_date: !currentlyPaid ? new Date().toISOString() : undefined,

  // ⭐ STORE THE ACTUAL PAYMENT AMOUNT
  amount: !currentlyPaid
    ? (paymentNumber === 0 ? stock.blank_payment : stock.payout_value)
    : undefined,

  detected_log_id: prev?.detected_log_id,
  detected_log_text: prev?.detected_log_text,
  detected_date: prev?.detected_date,
  detection_status: prev?.detection_status,
}));

    const action = !currentlyPaid ? 'marked as paid' : 'unmarked';
    if (Platform.OS === 'web') {
      alert(`Payment ${action}!`);
    } else {
      Alert.alert('Success', `Payment ${action}!`);
    }
  };

const handleDetectEvents = async () => {
  if (!stock) {
    Alert.alert('Error', 'Stock not loaded');
    return;
  }

  const investor = stock.investors[0];
  const items = investor?.items || [];

  if (items.length === 0) {
    Alert.alert(
      'Missing Items',
      'No item names are stored for this buddy. Add items in the Buddy Stocks page first.'
    );
    return;
  }

  setDetectingEvents(true);

  try {
    const key = await SecureStore.getItemAsync('torn_api_key');
    if (!key) {
      Alert.alert(
        'API Key Missing',
        'No Torn API key found. Please set it in Settings before using auto-detection.'
      );
      return;
    }

    const response = await axios.get(
      `https://api.torn.com/user/?selections=events&key=${key}`
    );

    const events = Object.values(response.data?.events || {});

    const updatedStates: { [paymentNumber: string]: PaymentsStateEntry } = {
      ...(stock.payments_state || {}),
    };

    const detected: {
      payment_number: number;
      investor: string;
      items: string[];
    }[] = [];

    const buddyName = (investor.user_name || stock.stock_name).toLowerCase();
    const itemNames = items.map((i) => i.name.toLowerCase());
    const windowMs = 48 * 60 * 60 * 1000;

    for (const payment of payments) {
      const due = new Date(payment.due_date);

      const matchingEvents = events.filter((ev: any) => {
        if (!ev.event) return false;

        const text = ev.event
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .toLowerCase();

        if (!text.includes(buddyName)) return false;

        const matchedItem = itemNames.find((name) => text.includes(name));
        if (!matchedItem) return false;

        const ts = new Date(ev.timestamp * 1000);
        const diff = Math.abs(ts.getTime() - due.getTime());
        if (diff > windowMs) return false;

        return true;
      });

      const keyNum = String(payment.payment_number);
      const prev = updatedStates[keyNum];

      if (matchingEvents.length > 0) {
        const lines: string[] = [];
        const allMatchedItemNames: string[] = [];

        matchingEvents.forEach((ev: any) => {
          const sender = extractSenderName(ev.event);
          const cleanText = ev.event
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase();

          const matchedItems = items
            .filter((i) => cleanText.includes(i.name.toLowerCase()))
            .map((i) => i.name);

          const ts = new Date(ev.timestamp * 1000);
          const time = ts.toLocaleTimeString();
          const date = ts.toLocaleDateString();

          matchedItems.forEach((name) => {
            lines.push(`${time} - ${date} ${sender} sent a ${name} to you`);
            allMatchedItemNames.push(name);
          });
        });

        const uiText = lines.join('\n');

        detected.push({
          payment_number: payment.payment_number,
          investor: investor.user_name || stock.stock_name,
          items: allMatchedItemNames,
        });

        updatedStates[keyNum] = {
          ...prev,
          paid: prev?.paid ?? false,
          paid_date: prev?.paid_date,
          detected_log_text: uiText,
          detected_date: new Date(
            matchingEvents[0].timestamp * 1000
          ).toISOString(),
          detection_status: 'found',
        };
      } else {
        updatedStates[keyNum] = {
          ...prev,
          paid: prev?.paid ?? false,
          paid_date: prev?.paid_date,
          detection_status: 'no_log_found',
        };
      }
    }

    await updatePaymentStateBulk(updatedStates);

    if (detected.length > 0) {
      const logDetails = detected
        .map(
          (d) =>
            `Payment #${d.payment_number}: ${d.items.join(', ')} from ${d.investor}`
        )
        .join('\n');

      Alert.alert(
        'Auto-Detection Complete',
        `Detected ${detected.length} payment(s):\n\n${logDetails}`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Auto-Detection Complete',
        'No matching events found within ±48 hours of due dates.',
        [{ text: 'OK' }]
      );
    }
  } catch (error) {
    console.error('Error detecting events from Torn API:', error);
    Alert.alert('Error', 'Failed to check events via Torn API');
  } finally {
    setDetectingEvents(false);
  }
};

  const updatePaymentStateBulk = async (
    updatedStates: { [paymentNumber: string]: PaymentsStateEntry }
  ) => {
    try {
      const json = await AsyncStorage.getItem('buddy_stocks');
      const allStocks: Stock[] = json ? JSON.parse(json) : [];
      const idx = allStocks.findIndex((s) => s.id === stockId);
      if (idx === -1) return;

      const current = allStocks[idx];
      const updatedStock: Stock = {
        ...current,
        payments_state: updatedStates,
      };

      allStocks[idx] = updatedStock;
      await AsyncStorage.setItem('buddy_stocks', JSON.stringify(allStocks));
      setStock(updatedStock);
      setPayments(generatePayments(updatedStock));
    } catch (error) {
      console.error('Error updating detection state:', error);
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
const extractSenderName = (html: string): string => {
  const match = html.match(/>([^<]+)<\/a>/);
  return match?.[1] ?? 'Unknown';
};
  const formatMoney = (amount: number) => {
    if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`;
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount}`;
  };

  // Split payments into paid and unpaid
  const paidPayments = payments.filter((p) => p.paid);
  const unpaidPayments = payments.filter((p) => !p.paid);

  // Sort unpaid by date (earliest first) and only show next 4
  const sortedUnpaidPayments = [...unpaidPayments]
    .sort(
      (a, b) =>
        new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    )
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
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#4caf50"
          />
        }
      >
        {/* Upcoming Payments Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="time-outline" size={18} color="#4caf50" /> Next{' '}
            {sortedUnpaidPayments.length} Payment
            {sortedUnpaidPayments.length !== 1 ? 's' : ''}
          </Text>

          {sortedUnpaidPayments.length === 0 ? (
            <View style={styles.emptySection}>
              <Ionicons name="checkmark-circle" size={48} color="#4caf50" />
              <Text style={styles.emptyText}>All payments received!</Text>
            </View>
          ) : (
            sortedUnpaidPayments.map((payment) => (
              <View
                key={payment.payment_number}
                style={[
                  styles.paymentCard,
                  isToday(payment.due_date) && styles.paymentCardDueToday,
                ]}
              >
                <View style={styles.paymentHeader}>
                  <Text style={styles.paymentNumber}>
                    Payment #{payment.payment_number}
                  </Text>
                  <View
                    style={[
                      styles.dueDateContainer,
                      isToday(payment.due_date) && styles.dueDateToday,
                    ]}
                  >
                    {isToday(payment.due_date) && (
                      <Text style={styles.todayBadge}>TODAY</Text>
                    )}
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color={
                        isToday(payment.due_date) ? '#ffc107' : '#888'
                      }
                    />
                    <Text
                      style={[
                        styles.dueDate,
                        isToday(payment.due_date) &&
                          styles.dueDateTextToday,
                      ]}
                    >
                      {formatDate(payment.due_date)}
                    </Text>
                  </View>
                </View>

                <View style={styles.investorsSection}>
                  {payment.investor_payments.map((inv, idx) => (
                    <View key={idx} style={styles.investorRowContainer}>
                      <View style={styles.investorRow}>
                        <View style={styles.investorInfo}>
                          <Text style={styles.investorName}>
                            {inv.user_name}
                          </Text>
                          <Text style={styles.investorAmount}>
                            {inv.item_name || 'Item'} -{' '}
                            {formatMoney(inv.amount)}
                          </Text>
                        </View>
                        <View style={styles.investorStatus}>
                          {inv.detected_log_id && (
                            <Ionicons
                              name="flash"
                              size={16}
                              color="#ffc107"
                              style={styles.autoDetectedIcon}
                            />
                          )}
                          {inv.paid ? (
                            <TouchableOpacity
                              onPress={() =>
                                handleMarkPaid(
                                  payment.payment_number,
                                  inv.user_id
                                )
                              }
                            >
                              <Ionicons
                                name="checkmark-circle"
                                size={24}
                                color="#4caf50"
                              />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() =>
                                openSendMoneyModal(payment, inv)
                              }
                            >
                              <Ionicons
                                name="ellipse-outline"
                                size={24}
                                color="#888"
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      {inv.detection_status === 'found' &&
                        inv.detected_log_text && (
                          <View style={styles.detectionInfo}>
                            <Ionicons
                              name="flash"
                              size={14}
                              color="#ffc107"
                            />
                            <Text style={styles.detectionText}>
                              {inv.detected_log_text}{' '}
                              {inv.detected_date &&
                                `(${formatDate(inv.detected_date)})`}
                            </Text>
                          </View>
                        )}
                      {inv.detection_status === 'no_log_found' && (
                        <View style={styles.detectionInfoMissing}>
                          <Ionicons
                            name="alert-circle-outline"
                            size={14}
                            color="#888"
                          />
                          <Text style={styles.noLogText}>
                            No log found within ±24hrs
                          </Text>
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
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color="#4caf50"
                />{' '}
                Paid Payments ({paidPayments.length})
              </Text>
              <Ionicons
                name={showPaidPayments ? 'chevron-up' : 'chevron-down'}
                size={24}
                color="#888"
              />
            </TouchableOpacity>

            {showPaidPayments && (
              <View style={styles.paidPaymentsList}>
                {paidPayments.map((payment) => (
                  <View
                    key={payment.payment_number}
                    style={[
                      styles.paymentCard,
                      styles.paidPaymentCard,
                    ]}
                  >
                    <View style={styles.paymentHeader}>
                      <View style={styles.paidBadge}>
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color="#fff"
                        />
                        <Text style={styles.paidBadgeText}>PAID</Text>
                      </View>
                      <Text style={styles.paymentNumberSmall}>
                        #{payment.payment_number}
                      </Text>
                      <Text style={styles.dueDateSmall}>
                        {formatDate(payment.due_date)}
                      </Text>
                    </View>

                    <View style={styles.investorsSection}>
                      {payment.investor_payments.map((inv, idx) => (
                        <View
                          key={idx}
                          style={styles.investorRowCompact}
                        >
                          <Text style={styles.investorNameCompact}>
                            {inv.user_name}
                          </Text>
                          <Text style={styles.investorAmountCompact}>
                            {formatMoney(inv.amount)}
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              handleMarkPaid(
                                payment.payment_number,
                                inv.user_id
                              )
                            }
                          >
                            <Ionicons
                              name="close-circle-outline"
                              size={20}
                              color="#888"
                            />
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
        onRequestClose={() =>
          setSendMoneyModal({ ...sendMoneyModal, visible: false })
        }
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Payment</Text>
              <TouchableOpacity
                onPress={() =>
                  setSendMoneyModal({ ...sendMoneyModal, visible: false })
                }
              >
                <Ionicons name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Pay to:</Text>
              <Text style={styles.modalValue}>
                {sendMoneyModal.userName}
              </Text>

              <Text style={styles.modalLabel}>Amount:</Text>
              <Text style={styles.modalAmount}>
                ${sendMoneyModal.amount.toLocaleString()}
              </Text>

              <TouchableOpacity
                style={styles.sendMoneyButton}
                onPress={handleCopyAndOpenProfile}
              >
                <Ionicons name="open-outline" size={20} color="#fff" />
                <Text style={styles.sendMoneyButtonText}>
                  Copy Amount & Open Profile
                </Text>
              </TouchableOpacity>
{/* Copy Event Log Button */}
<TouchableOpacity
  style={[styles.sendMoneyButton, { marginBottom: 10 }]}
  onPress={async () => {
    const payment = payments.find(
      p => p.payment_number === sendMoneyModal.paymentNumber
    );

    const inv = payment?.investor_payments?.[0];
    const log = inv?.detected_log_text;

    if (!log) {
      Alert.alert("No Event Found", "No detected event log for this payment.");
      return;
    }

    await Clipboard.setStringAsync(log);
    Alert.alert("Copied", "Event log copied to clipboard");
  }}
>
  <Ionicons name="copy-outline" size={20} color="#fff" />
  <Text style={styles.sendMoneyButtonText}>Copy Event Log</Text>
</TouchableOpacity>
              <View style={styles.modalDivider} />

              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleConfirmPayment}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color="#fff"
                />
                <Text style={styles.confirmButtonText}>
                  Mark as Paid
                </Text>
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
