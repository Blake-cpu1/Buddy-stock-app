import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

interface BuddyStock {
  id: string;
  user_id: number;
  user_name: string;
  item_name: string;
  interval_days: number;
  last_received: string | null;
  next_due: string | null;
  days_until_due: number | null;
  is_overdue: boolean;
}

export default function BuddyStocks() {
  const [buddyStocks, setBuddyStocks] = useState<BuddyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [userId, setUserId] = useState('');
  const [itemName, setItemName] = useState('');
  const [intervalDays, setIntervalDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchBuddyStocks();
  }, []);

  const fetchBuddyStocks = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/buddy-stocks`);
      setBuddyStocks(response.data.buddy_stocks);
    } catch (error: any) {
      console.error('Error fetching buddy stocks:', error);
      Alert.alert('Error', 'Failed to load buddy stocks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchBuddyStocks();
  }, []);

  const handleAddBuddyStock = async () => {
    if (!userId || !itemName || !intervalDays) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const userIdNum = parseInt(userId);
    const intervalNum = parseInt(intervalDays);

    if (isNaN(userIdNum) || isNaN(intervalNum) || intervalNum < 1) {
      Alert.alert('Error', 'Please enter valid numbers');
      return;
    }

    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/api/buddy-stocks`, {
        user_id: userIdNum,
        item_name: itemName,
        interval_days: intervalNum,
      });

      Alert.alert('Success', 'Buddy stock added successfully!');
      setModalVisible(false);
      setUserId('');
      setItemName('');
      setIntervalDays('');
      fetchBuddyStocks();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to add buddy stock';
      Alert.alert('Error', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkReceived = async (stockId: string, userName: string, itemName: string) => {
    try {
      await axios.put(`${API_URL}/api/buddy-stocks/${stockId}/received`);
      Alert.alert('Success', `Marked ${itemName} from ${userName} as received!`);
      fetchBuddyStocks();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to mark as received');
    }
  };

  const handleDelete = async (stockId: string, userName: string, itemName: string) => {
    Alert.alert(
      'Delete Buddy Stock',
      `Are you sure you want to remove ${itemName} from ${userName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await axios.delete(`${API_URL}/api/buddy-stocks/${stockId}`);
              Alert.alert('Success', 'Buddy stock removed');
              fetchBuddyStocks();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete buddy stock');
            }
          },
        },
      ]
    );
  };

  const formatDaysUntil = (stock: BuddyStock) => {
    if (stock.days_until_due === null) {
      return 'Not tracked yet';
    }

    if (stock.is_overdue) {
      const daysOverdue = Math.abs(stock.days_until_due);
      return `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`;
    }

    if (stock.days_until_due === 0) {
      return 'Due today!';
    }

    return `${stock.days_until_due} day${stock.days_until_due !== 1 ? 's' : ''}`;
  };

  const getStatusColor = (stock: BuddyStock) => {
    if (stock.days_until_due === null) return '#888';
    if (stock.is_overdue) return '#f44336';
    if (stock.days_until_due === 0) return '#ff9800';
    if (stock.days_until_due <= 2) return '#ffeb3b';
    return '#4caf50';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#d32f2f" />
        <Text style={styles.loadingText}>Loading buddy stocks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Buddy Stocks</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.addButton}>
          <Ionicons name="add-circle" size={28} color="#4caf50" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d32f2f" />}
      >
        {buddyStocks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={64} color="#666" />
            <Text style={styles.emptyTitle}>No Buddy Stocks Yet</Text>
            <Text style={styles.emptyText}>
              Add your first buddy stock to track items you receive from friends!
            </Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setModalVisible(true)}>
              <Text style={styles.emptyButtonText}>Add Buddy Stock</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {buddyStocks.map((stock) => (
              <View key={stock.id} style={styles.stockCard}>
                <View style={styles.stockHeader}>
                  <View style={styles.stockUserInfo}>
                    <Ionicons name="person-circle" size={20} color="#2196f3" />
                    <Text style={styles.stockUserName}>{stock.user_name}</Text>
                    <Text style={styles.stockUserId}>[{stock.user_id}]</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(stock.id, stock.user_name, stock.item_name)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={20} color="#f44336" />
                  </TouchableOpacity>
                </View>

                <View style={styles.stockBody}>
                  <View style={styles.itemRow}>
                    <Ionicons name="cube" size={18} color="#4caf50" />
                    <Text style={styles.itemName}>{stock.item_name}</Text>
                  </View>

                  <View style={styles.intervalRow}>
                    <Ionicons name="time-outline" size={16} color="#888" />
                    <Text style={styles.intervalText}>Every {stock.interval_days} days</Text>
                  </View>

                  <View style={styles.statusRow}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: getStatusColor(stock) + '20', borderColor: getStatusColor(stock) },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: getStatusColor(stock) }]}>
                        {formatDaysUntil(stock)}
                      </Text>
                    </View>
                  </View>

                  {stock.last_received && (
                    <Text style={styles.lastReceivedText}>
                      Last received: {new Date(stock.last_received).toLocaleDateString()}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.receivedButton}
                  onPress={() => handleMarkReceived(stock.id, stock.user_name, stock.item_name)}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.receivedButtonText}>Mark as Received</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Add Buddy Stock Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Buddy Stock</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Torn User ID</Text>
                <TextInput
                  style={styles.input}
                  value={userId}
                  onChangeText={setUserId}
                  placeholder="e.g., 3167627"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Item Name</Text>
                <TextInput
                  style={styles.input}
                  value={itemName}
                  onChangeText={setItemName}
                  placeholder="e.g., Drug Pack"
                  placeholderTextColor="#666"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Interval (Days)</Text>
                <TextInput
                  style={styles.input}
                  value={intervalDays}
                  onChangeText={setIntervalDays}
                  placeholder="e.g., 7"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
                <Text style={styles.helperText}>How often you receive this item</Text>
              </View>

              <TouchableOpacity
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                onPress={handleAddBuddyStock}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="add-circle-outline" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Add Buddy Stock</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  addButton: {
    padding: 4,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  emptyButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContainer: {
    padding: 20,
  },
  stockCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
  },
  stockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  stockUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockUserName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 8,
  },
  stockUserId: {
    fontSize: 14,
    color: '#888',
    marginLeft: 4,
  },
  deleteButton: {
    padding: 4,
  },
  stockBody: {
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  itemName: {
    fontSize: 16,
    color: '#4caf50',
    fontWeight: '600',
    marginLeft: 8,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  intervalText: {
    fontSize: 14,
    color: '#888',
    marginLeft: 6,
  },
  statusRow: {
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lastReceivedText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  receivedButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  receivedButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalBody: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    color: '#fff',
  },
  helperText: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  submitButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 8,
    marginTop: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});
