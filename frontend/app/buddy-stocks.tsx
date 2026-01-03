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
  const [editMode, setEditMode] = useState(false);
  
  // Form fields
  const [stockName, setStockName] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [daysPerPayout, setDaysPerPayout] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [payoutValue, setPayoutValue] = useState('');
  const [blankPayment, setBlankPayment] = useState('');
  const [itemNames, setItemNames] = useState('');  // Comma-separated item names
  const [itemsData, setItemsData] = useState<Array<{name: string, id: number, value: number}>>([]);
  
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

  const searchItemMarketValue = async (itemNamesStr: string) => {
    if (!itemNamesStr.trim()) {
      setItemsData([]);
      return;
    }

    // Parse comma-separated item names
    const itemNamesList = itemNamesStr.split(',').map(n => n.trim()).filter(n => n);
    const foundItems: Array<{name: string, id: number, value: number}> = [];
    const notFoundItems: string[] = [];

    for (const name of itemNamesList) {
      try {
        const response = await axios.get(`${API_URL}/api/items/search`, {
          params: { name }
        });
        foundItems.push({
          name: response.data.name,
          id: response.data.id,
          value: response.data.market_value
        });
      } catch (error: any) {
        if (error.response?.status === 404) {
          notFoundItems.push(name);
        }
      }
    }

    setItemsData(foundItems);

    if (notFoundItems.length > 0) {
      Alert.alert('Items Not Found', `Could not find: ${notFoundItems.join(', ')}`);
    }
  };

  const handleAddOrEditStock = async () => {
    // Validate form
    if (!stockName || !buddyId || !startDate || !daysPerPayout || !totalCost || !payoutValue || !blankPayment) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    // Build single investor (buddy) with 100% split and multiple items
    const investors = [{
      user_id: parseInt(buddyId),
      split_percentage: 100,
      items: itemsData.length > 0 ? itemsData : undefined,
      // Keep legacy fields for backwards compatibility
      item_name: itemsData.length > 0 ? itemsData.map(i => i.name).join(', ') : undefined,
      item_id: itemsData.length > 0 ? itemsData[0].id : undefined,
      market_value: itemsData.length > 0 ? itemsData.reduce((sum, i) => sum + i.value, 0) : undefined,
    }];

    setSubmitting(true);
    try {
      const stockData = {
        stock_name: stockName,
        start_date: startDate,
        days_per_payout: parseInt(daysPerPayout),
        total_cost: parseInt(totalCost),
        payout_value: parseInt(payoutValue),
        blank_payment: parseInt(blankPayment),
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
    setBuddyId('');
    setStartDate('');
    setDaysPerPayout('');
    setTotalCost('');
    setPayoutValue('');
    setBlankPayment('');
    setItemNames('');
    setItemsData([]);
    setEditingStock(null);
  };

  const openEditModal = (stock: Stock) => {
    setEditingStock(stock);
    setStockName(stock.stock_name);
    // Get buddy info from first investor
    const investor = stock.investors[0];
    setBuddyId(investor?.user_id?.toString() || '');
    
    // Load items data - could be multiple items
    if (investor?.items && investor.items.length > 0) {
      setItemNames(investor.items.map((i: any) => i.name).join(', '));
      setItemsData(investor.items);
    } else if (investor?.item_name) {
      // Legacy single item support
      setItemNames(investor.item_name);
      setItemsData([{
        name: investor.item_name,
        id: investor.item_id || 0,
        value: investor.market_value || 0
      }]);
    } else {
      setItemNames('');
      setItemsData([]);
    }
    
    setStartDate(stock.start_date);
    setDaysPerPayout(stock.days_per_payout.toString());
    setTotalCost(stock.total_cost.toString());
    setPayoutValue(stock.payout_value.toString());
    setBlankPayment(stock.blank_payment.toString());
    
    setModalVisible(true);
  };

  const handleDeleteStock = async (stockId: string, stockName: string) => {
    // Use window.confirm for web compatibility
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`Are you sure you want to delete "${stockName}"?`);
      if (confirmed) {
        try {
          await axios.delete(`${API_URL}/api/stocks/${stockId}`);
          alert('Stock deleted successfully');
          fetchStocks();
        } catch (error) {
          alert('Failed to delete stock');
        }
      }
    } else {
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
    }
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

  // Calculate overview stats
  const calculateOverview = () => {
    if (stocks.length === 0) return null;
    
    const totalCost = stocks.reduce((sum, s) => sum + s.total_cost, 0);
    const totalReceived = stocks.reduce((sum, s) => sum + (s.total_received || 0), 0);
    const totalPayoutsReceived = stocks.reduce((sum, s) => sum + (s.payouts_received || 0), 0);
    
    // Weekly payout value (sum of all payout values adjusted for frequency)
    const weeklyPayout = stocks.reduce((sum, s) => {
      const payoutsPerWeek = 7 / s.days_per_payout;
      return sum + (s.payout_value * payoutsPerWeek);
    }, 0);
    
    // Find next payout due (earliest)
    const nextPayouts = stocks
      .filter(s => s.next_payout_due)
      .map(s => ({ name: s.stock_name, date: s.next_payout_due! }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const nextPayoutDue = nextPayouts.length > 0 ? nextPayouts[0] : null;
    
    // Average ROI
    const avgRoi = stocks.reduce((sum, s) => sum + s.annualized_roi, 0) / stocks.length;
    
    return {
      totalCost,
      totalReceived,
      totalPayoutsReceived,
      weeklyPayout,
      nextPayoutDue,
      avgRoi,
      totalStocks: stocks.length,
    };
  };

  const overview = calculateOverview();

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
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setEditMode(!editMode)} style={styles.editModeButton}>
            <Ionicons name={editMode ? "create" : "create-outline"} size={24} color={editMode ? "#ffc107" : "#888"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { resetForm(); setModalVisible(true); }} style={styles.addButton}>
            <Ionicons name="add-circle" size={28} color="#4caf50" />
          </TouchableOpacity>
        </View>
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
            {/* Overview Dashboard */}
            {overview && (
              <View style={styles.overviewCard}>
                <View style={styles.overviewHeader}>
                  <Ionicons name="analytics-outline" size={24} color="#4caf50" />
                  <Text style={styles.overviewTitle}>Portfolio Overview</Text>
                </View>
                
                <View style={styles.overviewGrid}>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Total Invested</Text>
                    <Text style={styles.overviewValueCost}>{formatMoney(overview.totalCost)}</Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Total Received</Text>
                    <Text style={styles.overviewValueProfit}>{formatMoney(overview.totalReceived)}</Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Payouts/Week</Text>
                    <Text style={styles.overviewValue}>{formatMoney(overview.weeklyPayout)}</Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Avg ROI</Text>
                    <Text style={[styles.overviewValue, overview.avgRoi >= 0 ? styles.roiPositive : styles.roiNegative]}>
                      {overview.avgRoi >= 0 ? '+' : ''}{overview.avgRoi.toFixed(1)}%
                    </Text>
                  </View>
                </View>

                <View style={styles.overviewFooter}>
                  <View style={styles.overviewFooterItem}>
                    <Ionicons name="calendar-outline" size={16} color="#4caf50" />
                    <Text style={styles.overviewFooterLabel}>Next Payout:</Text>
                    {overview.nextPayoutDue ? (
                      <Text style={styles.overviewFooterValue}>
                        {overview.nextPayoutDue.name} - {formatDateUK(overview.nextPayoutDue.date)}
                      </Text>
                    ) : (
                      <Text style={styles.overviewFooterValueMuted}>All caught up!</Text>
                    )}
                  </View>
                  <View style={styles.overviewFooterItem}>
                    <Ionicons name="checkmark-circle-outline" size={16} color="#4caf50" />
                    <Text style={styles.overviewFooterLabel}>Total Payouts:</Text>
                    <Text style={styles.overviewFooterValue}>{overview.totalPayoutsReceived}</Text>
                  </View>
                </View>
              </View>
            )}

            <Text style={styles.sectionTitle}>Your Investments ({stocks.length})</Text>
            
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

                {/* Show buddy item info */}
                {stock.investors[0]?.item_name && (
                  <View style={styles.buddyItemSection}>
                    <Text style={styles.buddyItemText}>
                      Item: {stock.investors[0].item_name} {stock.investors[0].market_value && `(${formatMoney(stock.investors[0].market_value)})`}
                    </Text>
                  </View>
                )}

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
              <View style={styles.inputRow}>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Buddy Name</Text>
                  <TextInput style={styles.input} value={stockName} onChangeText={setStockName} placeholder="e.g., JAK86" placeholderTextColor="#666" />
                </View>
                <View style={styles.inputHalf}>
                  <Text style={styles.label}>Buddy ID</Text>
                  <TextInput style={styles.input} value={buddyId} onChangeText={setBuddyId} placeholder="e.g., 3549633" placeholderTextColor="#666" keyboardType="numeric" />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-01-01" placeholderTextColor="#666" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Days Per Payout</Text>
                <TextInput style={styles.input} value={daysPerPayout} onChangeText={setDaysPerPayout} placeholder="7" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Total Cost</Text>
                <TextInput style={styles.input} value={totalCost} onChangeText={setTotalCost} placeholder="1000000" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Payout Value</Text>
                <TextInput style={styles.input} value={payoutValue} onChangeText={setPayoutValue} placeholder="150000" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{stockName || 'Buddy'} Payment</Text>
                <TextInput style={styles.input} value={blankPayment} onChangeText={setBlankPayment} placeholder="50000" placeholderTextColor="#666" keyboardType="numeric" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Item Names (comma separated for auto-detect)</Text>
                <TextInput 
                  style={styles.input} 
                  value={itemNames} 
                  onChangeText={setItemNames}
                  onBlur={() => searchItemMarketValue(itemNames)}
                  placeholder="e.g., Drug Pack, Box of Medical Supplies" 
                  placeholderTextColor="#666" 
                />
                {itemsData.length > 0 && (
                  <View style={styles.itemsListContainer}>
                    {itemsData.map((item, idx) => (
                      <Text key={idx} style={styles.marketValueText}>
                        ✓ {item.name}: {formatMoney(item.value)}
                      </Text>
                    ))}
                  </View>
                )}
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
  overviewCard: {
    backgroundColor: '#1a2e1a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2d4a2d',
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d4a2d',
  },
  overviewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 10,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  overviewItem: {
    width: '50%',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  overviewLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  overviewValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  overviewValueCost: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f44336',
  },
  overviewValueProfit: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4caf50',
  },
  overviewFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2d4a2d',
  },
  overviewFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  overviewFooterLabel: {
    fontSize: 13,
    color: '#888',
    marginLeft: 8,
    marginRight: 4,
  },
  overviewFooterValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  overviewFooterValueMuted: {
    fontSize: 13,
    color: '#4caf50',
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
    marginBottom: 16,
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
  buddyItemSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  buddyItemText: {
    fontSize: 14,
    color: '#4caf50',
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
  itemsListContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
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
