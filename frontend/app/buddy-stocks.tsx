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

interface Investor {
  user_id: number;
  user_name?: string;
  split_percentage: number;
  item_name?: string;
  item_id?: number;
  market_value?: number;
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
}

export default function BuddyStocks() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingStock, setEditingStock] = useState<Stock | null>(null);
  
  // Form fields
  const [stockName, setStockName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [investmentLength, setInvestmentLength] = useState('');
  const [daysPerPayout, setDaysPerPayout] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [payoutValue, setPayoutValue] = useState('');
  const [blankPayment, setBlankPayment] = useState('');
  const [payoutsReceived, setPayoutsReceived] = useState('0');
  const [investorIds, setInvestorIds] = useState<string[]>(['']);
  const [investorSplits, setInvestorSplits] = useState<string[]>(['100']);
  const [investorItems, setInvestorItems] = useState<string[]>(['']);
  const [investorItemValues, setInvestorItemValues] = useState<(number | null)[]>([null]);
  const [investorItemIds, setInvestorItemIds] = useState<(number | null)[]>([null]);
  
  const router = useRouter();

  useEffect(() => {
    fetchStocks();
  }, []);

  const fetchStocks = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/stocks`);
      setStocks(response.data.stocks);
    } catch (error: any) {
      console.error('Error fetching stocks:', error);
      Alert.alert('Error', 'Failed to load stocks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStocks();
  }, []);

  const searchItemMarketValue = async (itemName: string, index: number) => {
    if (!itemName.trim()) {
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/api/items/search`, {
        params: { name: itemName }
      });
      
      const newValues = [...investorItemValues];
      const newIds = [...investorItemIds];
      newValues[index] = response.data.market_value;
      newIds[index] = response.data.id;
      setInvestorItemValues(newValues);
      setInvestorItemIds(newIds);
    } catch (error: any) {
      const newValues = [...investorItemValues];
      const newIds = [...investorItemIds];
      newValues[index] = null;
      newIds[index] = null;
      setInvestorItemValues(newValues);
      setInvestorItemIds(newIds);
      
      if (error.response?.status === 404) {
        Alert.alert('Item Not Found', `Could not find "${itemName}" in Torn item database`);
      }
    }
  };

  const handleAddOrEditStock = async () => {
    // Validate form
    if (!stockName || !startDate || !investmentLength || !daysPerPayout || !totalCost || !payoutValue || !blankPayment) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    // Validate investor data
    const validInvestors = investorIds.filter((id, idx) => id && investorSplits[idx]);
    if (validInvestors.length === 0) {
      Alert.alert('Error', 'Please add at least one investor');
      return;
    }

    // Build investors array
    const investors = validInvestors.map((id, idx) => ({
      user_id: parseInt(id),
      split_percentage: parseFloat(investorSplits[idx]),
      item_name: investorItems[idx] || undefined,
      item_id: investorItemIds[idx] || undefined,
      market_value: investorItemValues[idx] || undefined,
    }));

    // Validate splits total to 100
    const totalSplit = investors.reduce((sum, inv) => sum + inv.split_percentage, 0);
    if (Math.abs(totalSplit - 100) > 0.01) {
      Alert.alert('Error', `Investor splits must total 100%, currently ${totalSplit.toFixed(1)}%`);
      return;
    }

    setSubmitting(true);
    try {
      const stockData = {
        stock_name: stockName,
        start_date: startDate,
        investment_length_days: parseInt(investmentLength),
        days_per_payout: parseInt(daysPerPayout),
        total_cost: parseInt(totalCost),
        payout_value: parseInt(payoutValue),
        blank_payment: parseInt(blankPayment),
        payouts_received: parseInt(payoutsReceived),
        investors,
      };

      if (editingStock) {
        // Update existing stock
        await axios.put(`${API_URL}/api/stocks/${editingStock.id}`, stockData);
        Alert.alert('Success', 'Stock updated successfully!');
      } else {
        // Create new stock
        await axios.post(`${API_URL}/api/stocks`, stockData);
        Alert.alert('Success', 'Stock added successfully!');
      }

      setModalVisible(false);
      resetForm();
      fetchStocks();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || `Failed to ${editingStock ? 'update' : 'add'} stock`;
      Alert.alert('Error', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStockName('');
    setStartDate('');
    setInvestmentLength('');
    setDaysPerPayout('');
    setTotalCost('');
    setPayoutValue('');
    setBlankPayment('');
    setPayoutsReceived('0');
    setInvestorIds(['']);
    setInvestorSplits(['100']);
    setInvestorItems(['']);
    setInvestorItemValues([null]);
    setInvestorItemIds([null]);
    setEditingStock(null);
  };

  const openEditModal = (stock: Stock) => {
    setEditingStock(stock);
    setStockName(stock.stock_name);
    setStartDate(stock.start_date);
    setInvestmentLength(stock.investment_length_days.toString());
    setDaysPerPayout(stock.days_per_payout.toString());
    setTotalCost(stock.total_cost.toString());
    setPayoutValue(stock.payout_value.toString());
    setBlankPayment(stock.blank_payment.toString());
    setPayoutsReceived((stock.payouts_received || 0).toString());
    
    // Load investors
    const ids = stock.investors.map(inv => inv.user_id.toString());
    const splits = stock.investors.map(inv => inv.split_percentage.toString());
    const items = stock.investors.map(inv => inv.item_name || '');
    const values = stock.investors.map(inv => inv.market_value || null);
    const itemIds = stock.investors.map(inv => inv.item_id || null);
    
    setInvestorIds(ids);
    setInvestorSplits(splits);
    setInvestorItems(items);
    setInvestorItemValues(values);
    setInvestorItemIds(itemIds);
    
    setModalVisible(true);
  };

  const handleDeleteStock = async (stockId: string, stockName: string) => {
    Alert.alert(
      'Delete Stock',
      `Are you sure you want to delete "${stockName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await axios.delete(`${API_URL}/api/stocks/${stockId}`);
              Alert.alert('Success', 'Stock deleted');
              fetchStocks();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete stock');
            }
          },
        },
      ]
    );
  };

  const formatMoney = (amount: number) => {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount}`;
  };

  const formatDateUK = (dateStr: string) => {
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

  const addInvestorRow = () => {
    setInvestorIds([...investorIds, '']);
    setInvestorSplits([...investorSplits, '']);
    setInvestorItems([...investorItems, '']);
    setInvestorItemValues([...investorItemValues, null]);
    setInvestorItemIds([...investorItemIds, null]);
  };

  const removeInvestorRow = (index: number) => {
    setInvestorIds(investorIds.filter((_, i) => i !== index));
    setInvestorSplits(investorSplits.filter((_, i) => i !== index));
    setInvestorItems(investorItems.filter((_, i) => i !== index));
    setInvestorItemValues(investorItemValues.filter((_, i) => i !== index));
    setInvestorItemIds(investorItemIds.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4caf50" />
        <Text style={styles.loadingText}>Loading stocks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Stock Investments</Text>
        <TouchableOpacity onPress={() => { resetForm(); setModalVisible(true); }} style={styles.addButton}>
          <Ionicons name="add-circle" size={28} color="#4caf50" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4caf50" />}
      >
        {stocks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="trending-up-outline" size={64} color="#666" />
            <Text style={styles.emptyTitle}>No Stocks Yet</Text>
            <Text style={styles.emptyText}>Add your first stock investment to start tracking!</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={() => setModalVisible(true)}>
              <Text style={styles.emptyButtonText}>Add Stock</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {stocks.map((stock) => (
              <View key={stock.id} style={styles.stockCard}>
                <View style={styles.stockHeader}>
                  <Text style={styles.stockName}>{stock.stock_name}</Text>
                  <View style={styles.stockActions}>
                    <TouchableOpacity onPress={() => openEditModal(stock)} style={styles.actionIcon}>
                      <Ionicons name="create-outline" size={22} color="#2196f3" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteStock(stock.id, stock.stock_name)} style={styles.actionIcon}>
                      <Ionicons name="trash-outline" size={20} color="#f44336" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.stockGrid}>
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>Start Date</Text>
                    <Text style={styles.gridValue}>{formatDateUK(stock.start_date)}</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>Days</Text>
                    <Text style={styles.gridValue}>{stock.days_since_start} days</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>Payout Every</Text>
                    <Text style={styles.gridValue}>{stock.days_per_payout} days</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Text style={styles.gridLabel}>Total Payouts</Text>
                    <Text style={styles.gridValue}>{stock.payouts_received || 0}</Text>
                  </View>
                </View>

                <View style={styles.moneyGrid}>
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>Cost</Text>
                    <Text style={styles.moneyCost}>{formatMoney(stock.total_cost)}</Text>
                  </View>
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>Payout Value</Text>
                    <Text style={styles.moneyValue}>{formatMoney(stock.payout_value)}</Text>
                  </View>
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>{stock.stock_name}</Text>
                    <Text style={styles.moneyValue}>{formatMoney(stock.blank_payment)}</Text>
                  </View>
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>Payout Due</Text>
                    <Text style={styles.moneyValue}>
                      {stock.next_payout_due ? formatDateUK(stock.next_payout_due) : 'All paid'}
                    </Text>
                    <Text style={[styles.roiText, stock.annualized_roi >= 0 ? styles.roiPositive : styles.roiNegative]}>
                      ROI: {stock.annualized_roi >= 0 ? '+' : ''}{stock.annualized_roi}%
                    </Text>
                  </View>
                  <View style={styles.moneyItem}>
                    <Text style={styles.moneyLabel}>Total Received</Text>
                    <Text style={styles.moneyProfit}>{formatMoney(stock.total_received || 0)}</Text>
                  </View>
                </View>

                <View style={styles.investorSection}>
                  <Text style={styles.investorTitle}>Investors:</Text>
                  {stock.investors.map((inv, idx) => (
                    <View key={idx}>
                      <Text style={styles.investorText}>
                        {inv.user_name || `User ${inv.user_id}`} ({inv.split_percentage}%)
                      </Text>
                      {inv.item_name && (
                        <Text style={styles.itemText}>
                          → {inv.item_name} {inv.market_value && `(${formatMoney(inv.market_value)})`}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={styles.viewPaymentsButton}
                  onPress={() => router.push({
                    pathname: '/payment-schedule',
                    params: { stockId: stock.id, stockName: stock.stock_name }
                  })}
                >
                  <Ionicons name="calendar-outline" size={20} color="#fff" />
                  <Text style={styles.viewPaymentsText}>View Payment Schedule</Text>
                  <Ionicons name="chevron-forward" size={20} color="#888" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Add/Edit Stock Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingStock ? 'Edit' : 'Add'} Stock Investment</Text>
              <TouchableOpacity onPress={() => { setModalVisible(false); resetForm(); }}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Stock Name</Text>
                <TextInput style={styles.input} value={stockName} onChangeText={setStockName} placeholder="e.g., Casino Lease 1" placeholderTextColor="#666" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-01-01" placeholderTextColor="#666" />
              </View>

              <View style={styles.inputRow}>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Investment Length (Days)</Text>
                  <TextInput style={styles.input} value={investmentLength} onChangeText={setInvestmentLength} placeholder="60" placeholderTextColor="#666" keyboardType="numeric" />
                </View>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Days Per Payout</Text>
                  <TextInput style={styles.input} value={daysPerPayout} onChangeText={setDaysPerPayout} placeholder="7" placeholderTextColor="#666" keyboardType="numeric" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Total Cost</Text>
                <TextInput style={styles.input} value={totalCost} onChangeText={setTotalCost} placeholder="1000000" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.inputRow}>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Payout Value</Text>
                  <TextInput style={styles.input} value={payoutValue} onChangeText={setPayoutValue} placeholder="150000" placeholderTextColor="#666" keyboardType="numeric" />
                </View>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Payouts Received</Text>
                  <TextInput style={styles.input} value={payoutsReceived} onChangeText={setPayoutsReceived} placeholder="0" placeholderTextColor="#666" keyboardType="numeric" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{stockName || 'Blank Payment'}</Text>
                <TextInput style={styles.input} value={blankPayment} onChangeText={setBlankPayment} placeholder="50000" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.investorsSection}>
                <View style={styles.investorsSectionHeader}>
                  <Text style={styles.sectionTitle}>Investors (must total 100%)</Text>
                  <TouchableOpacity onPress={addInvestorRow} style={styles.addInvestorBtn}>
                    <Ionicons name="add-circle-outline" size={24} color="#4caf50" />
                  </TouchableOpacity>
                </View>

                {investorIds.map((id, idx) => (
                  <View key={idx} style={styles.investorRowContainer}>
                    <View style={styles.investorRow}>
                      <TextInput 
                        style={[styles.input, styles.investorIdInput]} 
                        value={id} 
                        onChangeText={(text) => {
                          const newIds = [...investorIds];
                          newIds[idx] = text;
                          setInvestorIds(newIds);
                        }} 
                        placeholder="User ID" 
                        placeholderTextColor="#666" 
                        keyboardType="numeric" 
                      />
                      
                      <TextInput 
                        style={[styles.input, styles.investorSplitInput]} 
                        value={investorSplits[idx]} 
                        onChangeText={(text) => {
                          const newSplits = [...investorSplits];
                          newSplits[idx] = text;
                          setInvestorSplits(newSplits);
                        }} 
                        placeholder="%" 
                        placeholderTextColor="#666" 
                        keyboardType="numeric" 
                      />
                      
                      {investorIds.length > 1 && (
                        <TouchableOpacity onPress={() => removeInvestorRow(idx)}>
                          <Ionicons name="remove-circle-outline" size={24} color="#f44336" />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.itemRow}>
                      <TextInput 
                        style={[styles.input, styles.itemInput]} 
                        value={investorItems[idx]} 
                        onChangeText={(text) => {
                          const newItems = [...investorItems];
                          newItems[idx] = text;
                          setInvestorItems(newItems);
                        }}
                        onBlur={() => searchItemMarketValue(investorItems[idx], idx)}
                        placeholder="Item name (e.g., Drug Pack)" 
                        placeholderTextColor="#666" 
                      />
                    </View>

                    {investorItemValues[idx] !== null && (
                      <Text style={styles.marketValueText}>
                        Market Value: {formatMoney(investorItemValues[idx]!)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>

              <TouchableOpacity 
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]} 
                onPress={handleAddOrEditStock} 
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name={editingStock ? "checkmark-circle-outline" : "add-circle-outline"} size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>{editingStock ? 'Update' : 'Add'} Stock</Text>
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
    borderLeftColor: '#4caf50',
  },
  stockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  stockName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  stockActions: {
    flexDirection: 'row',
  },
  actionIcon: {
    padding: 4,
    marginLeft: 8,
  },
  stockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  gridItem: {
    width: '50%',
    marginBottom: 12,
  },
  gridLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  moneyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  moneyItem: {
    width: '50%',
    marginBottom: 8,
  },
  moneyLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  moneyCost: {
    fontSize: 16,
    color: '#f44336',
    fontWeight: 'bold',
  },
  moneyValue: {
    fontSize: 16,
    color: '#2196f3',
    fontWeight: 'bold',
  },
  moneyProfit: {
    fontSize: 16,
    color: '#4caf50',
    fontWeight: 'bold',
  },
  roiText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  roiPositive: {
    color: '#4caf50',
  },
  roiNegative: {
    color: '#f44336',
  },
  investorSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  investorTitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 6,
  },
  investorText: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 4,
  },
  itemText: {
    fontSize: 13,
    color: '#4caf50',
    marginLeft: 16,
    marginBottom: 4,
  },
  viewPaymentsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196f3',
    padding: 14,
    borderRadius: 8,
    marginTop: 16,
    justifyContent: 'space-between',
  },
  viewPaymentsText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
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
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  inputHalf: {
    width: '48%',
  },
  label: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#fff',
  },
  sectionTitle: {
    fontSize: 16,
    color: '#fff',
    fontWeight: 'bold',
  },
  investorsSection: {
    marginBottom: 16,
  },
  investorsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addInvestorBtn: {
    padding: 4,
  },
  investorRowContainer: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  investorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  investorIdInput: {
    flex: 2,
    marginRight: 8,
  },
  investorSplitInput: {
    flex: 1,
    marginRight: 8,
  },
  itemRow: {
    marginBottom: 8,
  },
  itemInput: {
    flex: 1,
  },
  marketValueText: {
    fontSize: 13,
    color: '#4caf50',
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#4caf50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 8,
    marginTop: 10,
    marginBottom: 20,
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
