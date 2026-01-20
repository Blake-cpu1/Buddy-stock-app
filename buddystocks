import { useFocusEffect } from '@react-navigation/native';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { TouchableWithoutFeedback, Keyboard } from 'react-native';
import * as Clipboard from 'expo-clipboard';
interface Investor {
  user_id: number;
  user_name?: string;
  split_percentage: number;
  item_name?: string;
  item_id?: number;
  market_value?: number;
  // For multi-item support
  items?: Array<{ name: string; id: number; value: number }>;
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
  payments_state?: Record<string, any>;
}

const MARKETPLACE_CACHE_KEY = 'weav3r_marketplace_cache_v1';

export default function BuddyStocks() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingStock, setEditingStock] = useState<Stock | null>(null);
  const [editMode, setEditMode] = useState(false);
  const isEditing = editingStock !== null;
  const [importExportModal, setImportExportModal] = useState(false);
const [importText, setImportText] = useState('');
const [exportText, setExportText] = useState('');

// Copy JSON to clipboard
const copyBackup = async () => {
  await Clipboard.setStringAsync(importText);
  Alert.alert("Copied", "Backup JSON copied to clipboard.");
};

// Save backup JSON to AsyncStorage
const saveBackup = async () => {
  await AsyncStorage.setItem("buddy_backup_text", importText);
  Alert.alert("Saved", "Backup saved on device.");
};

// Load backup JSON from AsyncStorage
const loadBackup = async () => {
  const saved = await AsyncStorage.getItem("buddy_backup_text");
  if (!saved) {
    Alert.alert("No Backup", "No saved backup found.");
    return;
  }
  setImportText(saved);
  Alert.alert("Loaded", "Backup loaded into text box.");
};

// Clear all stocks
const clearAllData = async () => {
  Alert.alert(
    "Clear All Data",
    "Are you sure you want to delete ALL stocks?",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("buddy_stocks");
          fetchStocks();
          Alert.alert("Cleared", "All stock data removed.");
        }
      }
    ]
  );
};

  // Form fields
  const [stockName, setStockName] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [daysPerPayout, setDaysPerPayout] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [payoutValue, setPayoutValue] = useState('');
  const [blankPayment, setBlankPayment] = useState('');
  const [itemNames, setItemNames] = useState(''); // Comma-separated item names
  const [itemsData, setItemsData] = useState<Array<{ name: string; id: number; value: number }>>([]);
  const [payoutType, setPayoutType] = useState<'bank' | 'stock'>('bank');

  // Weav3r marketplace cache
  const [marketplaceItems, setMarketplaceItems] = useState<any[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);

  const router = useRouter();

const recomputeStockTotals = (stock: Stock) => {
  const payments = stock.payments_state || {};

  // Normalize: unwrap arrays like { "1": [ { ... } ] }
  const normalizedPayments = Object.fromEntries(
    Object.entries(payments).map(([key, value]) => {
      const payment = Array.isArray(value) ? value[0] : value;
      return [key, payment];
    })
  );

  // Count paid payouts
  const payouts_received = Object.values(normalizedPayments)
    .filter((p: any) => p.paid === true).length;

  // Total received = sum of actual paid amounts
  const total_received = Object.values(normalizedPayments)
    .filter((p: any) => p.paid === true)
    .reduce((sum, p: any) => sum + (p.amount || 0), 0);

// Find next unpaid payout index
const unpaidEntries = Object.entries(normalizedPayments)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .filter(([_, p]: any) => !p.paid);

let next_payout_due: string | undefined = undefined;

if (unpaidEntries.length > 0) {
  const [key, _payment] = unpaidEntries[0];

  const paymentNumber = parseInt(key, 10);
  const start = new Date(stock.start_date);

  // Payment #1 = start + days_per_payout
  // Payment #2 = start + 2 * days_per_payout
  // Payment #3 = start + 3 * days_per_payout
  const dueDate = new Date(start);
dueDate.setDate(
  dueDate.getDate() + paymentNumber * stock.days_per_payout
);

  next_payout_due = dueDate.toISOString();
}

  // ⭐ Unified ROI logic (bank + stock)
  let annualized_roi = 0;

  if (
    stock.total_cost > 0 &&
    stock.payout_value > 0 &&
    stock.days_per_payout > 0
  ) {
    const annualCash = (stock.payout_value / stock.days_per_payout) * 365;
    annualized_roi = (annualCash / stock.total_cost) * 100;
  }

  // Days since start
  const days_since_start = Math.floor(
    (Date.now() - new Date(stock.start_date).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return {
    ...stock,
    payouts_received,
    total_received,
    next_payout_due,
    annualized_roi: parseFloat(annualized_roi.toFixed(2)),
    days_since_start,
  };
};

// Load stocks from local storage
const fetchStocks = async () => {
  try {
    const json = await AsyncStorage.getItem('buddy_stocks');
    const raw = json ? JSON.parse(json) : [];

    // Recompute totals for every stock
    const updated = raw.map((s: Stock) => recomputeStockTotals(s));

    setStocks(updated);
  } catch (error) {
    console.error('Error loading stocks:', error);
    Alert.alert('Error', 'Failed to load stocks');
  } finally {
    setLoading(false);
    setRefreshing(false);
  }
};

  // Load marketplace items from AsyncStorage, or fetch if missing
  const loadMarketplaceFromCache = async () => {
    try {
      const cached = await AsyncStorage.getItem(MARKETPLACE_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        if (Array.isArray(data.items)) {
          setMarketplaceItems(data.items);
          return;
        }
      }
      // If no cache or invalid, fetch fresh
      await refreshMarketplaceData(true);
    } catch (error) {
      console.error('Error loading marketplace cache:', error);
    }
  };

  const refreshMarketplaceData = async (silent = false) => {
    try {
      if (!silent) setMarketplaceLoading(true);

      const res = await axios.get('https://weav3r.dev/api/marketplace');
      const items = res.data?.items || [];

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Invalid marketplace response');
      }

      setMarketplaceItems(items);
      await AsyncStorage.setItem(
        MARKETPLACE_CACHE_KEY,
        JSON.stringify({ items, updated_at: Date.now() })
      );

      if (!silent) {
        Alert.alert('Marketplace Updated', 'Marketplace data has been refreshed.');
      }
    } catch (error) {
      console.error('Error refreshing marketplace data:', error);
      if (!silent) {
        Alert.alert(
          'Error',
          'Failed to refresh marketplace data. Using last cached data if available.'
        );
      }
    } finally {
      if (!silent) setMarketplaceLoading(false);
    }
  };

  useEffect(() => {
    fetchStocks();
    loadMarketplaceFromCache();
  }, []);
  useFocusEffect(
  useCallback(() => {
    fetchStocks(); // reload from AsyncStorage every time screen is focused
  }, [])
);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStocks();
  }, []);

  // Resolve a single item name using cached Weav3r marketplace data
  const resolveItemFromMarketplace = async (name: string) => {
    // Ensure we have some marketplace data
    if (!marketplaceItems || marketplaceItems.length === 0) {
      await loadMarketplaceFromCache();
    }

    if (!marketplaceItems || marketplaceItems.length === 0) {
      console.warn('No marketplace items available to resolve:', name);
      return null;
    }

    const lower = name.toLowerCase();

    // Exact case-insensitive match
    const match = marketplaceItems.find(
      (i: any) => typeof i.name === 'string' && i.name.toLowerCase() === lower
    );

    if (match) {
      return {
        name: match.name,
        id: match.id,
        value: match.market_value ?? 0,
      };
    }

    // Optional: soft match / contains (commented, enable if you want fuzzier behavior)
const softMatch = marketplaceItems.find(
  (i: any) =>
    typeof i.name === 'string' &&
    i.name.toLowerCase().includes(lower)
);

if (softMatch) {
  return {
    name: softMatch.name,
    id: softMatch.id,
    value: softMatch.market_value ?? 0,
  };
}

    return null;
  };

  const handleAddOrEditStock = async () => {
   if (!payoutType) {
  Alert.alert("Missing Payout Type", "Please select Bank or Stock before saving.");
  return;
}
    // Validate form
    if (
      !stockName ||
      !buddyId ||
      !startDate ||
      !daysPerPayout ||
      !totalCost ||
      !payoutValue ||
      !blankPayment
    ) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    // Build investor with multi-item + legacy fields for display
const parsedItems = parseItemNames(itemNames);

const investor: Investor = {
  user_id: parseInt(buddyId),
  split_percentage: 100,
  items: parsedItems,        // array of item objects
  item_name: itemNames,      // the raw comma‑separated string
  item_id: parsedItems[0]?.id,
  market_value: 0,           // no marketplace, so default to 0
};

// Build stock object
const stockData: Stock = {
  id: editingStock ? editingStock.id : Date.now().toString(),
  stock_name: stockName,
  payout_type: payoutType, // ⭐ NEW FIELD

  start_date: startDate,
  total_cost: parseInt(totalCost),

  // ⭐ BANK PAYOUT FIELDS (only meaningful if payout_type === 'bank')
days_per_payout: parseInt(daysPerPayout),
payout_value: parseInt(payoutValue),
blank_payment: parseInt(blankPayment),

  // ⭐ STOCK PAYOUT FIELDS (placeholder for future use)
  shares: payoutType === 'stock' ? 0 : undefined,
  buy_price: payoutType === 'stock' ? 0 : undefined,

  investors: [investor],

  total_payouts: editingStock?.total_payouts ?? 0,
  payouts_received: editingStock?.payouts_received ?? 0,
  total_received: editingStock?.total_received ?? 0,
  blake_total: editingStock?.blake_total ?? 0,
  next_payout_due: editingStock?.next_payout_due,
  days_since_start: editingStock?.days_since_start ?? 0,
  annualized_roi: editingStock?.annualized_roi ?? 0,
};

    setSubmitting(true);

    try {
      let updated: Stock[];

      if (editingStock) {
        // Update existing stock
updated = stocks.map((s) =>
  s.id === editingStock.id
    ? { ...s, ...stockData, investors: [investor] }
    : s
);
      } else {
        // Add new stock
        updated = [...stocks, stockData];
      }

      // Save to local storage
      await AsyncStorage.setItem('buddy_stocks', JSON.stringify(updated));
      setStocks(updated);

      Alert.alert('Success', editingStock ? 'Stock updated!' : 'Stock added!');
      setModalVisible(false);
      resetForm();
    } catch (error) {
      console.error('Error saving stock locally:', error);
      Alert.alert('Error', 'Failed to save stock locally');
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
    setEditMode(false);
  };
const exportData = async () => {
  try {
    const stocksJson = await AsyncStorage.getItem('buddy_stocks');

    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      stocks: stocksJson ? JSON.parse(stocksJson) : [],
    };

    const text = JSON.stringify(payload, null, 2);
    setExportText(text);
    setImportText(text);
    setImportExportModal(true);
  } catch (err) {
    console.error('Export failed:', err);
    Alert.alert('Error', 'Failed to export data');
  }
};
const importData = async () => {
  try {
    const parsed = JSON.parse(importText);

    if (!parsed.stocks) {
      Alert.alert('Invalid backup', 'This file does not contain stock data.');
      return;
    }

    await AsyncStorage.setItem('buddy_stocks', JSON.stringify(parsed.stocks));

    Alert.alert('Success', 'Data imported successfully!');
    setImportExportModal(false);
    fetchStocks();
  } catch (err) {
    console.error('Import failed:', err);
    Alert.alert('Error', 'Invalid JSON format');
  }
};
  // Convert comma-separated item names → array of item objects
  const parseItemNames = (names: string) => {
    return names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, index) => ({
        name,
        id: index + 1,
        value: 0, // no marketplace, so default to 0
      }));
  };

  const openEditModal = (stock: Stock) => {
    setEditingStock(stock);
    setEditMode(true);
    setStockName(stock.stock_name);
    setPayoutType(stock.payout_type as 'bank' | 'stock');

    // Get buddy info from first investor
    const investor = stock.investors[0];
    setBuddyId(investor?.user_id?.toString() || '');

    // Load items data (manual entry, no marketplace)
    if (investor?.items && investor.items.length > 0) {
      // New format
      setItemNames(investor.items.map((i) => i.name).join(', '));
      setItemsData(investor.items);
    } else if (investor?.item_name) {
      // Legacy OR saved string format
      setItemNames(investor.item_name);
      setItemsData(parseItemNames(investor.item_name));
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
    Alert.alert('Delete Stock', `Are you sure you want to delete "${stockName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const updated = stocks.filter((s) => s.id !== stockId);
            await AsyncStorage.setItem('buddy_stocks', JSON.stringify(updated));
            setStocks(updated);
            Alert.alert('Success', 'Stock deleted');
          } catch (error) {
            console.error('Error deleting stock locally:', error);
            Alert.alert('Error', 'Failed to delete stock');
          }
        },
      },
    ]);
  };

  const formatMoney = (amount: number) => {
    if (amount >= 1000000000) return `$${(amount / 1000000000).toFixed(2)}B`;
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
    return `$${amount}`;
  };

// Calculate days to breakeven
const calculateDaysToBreakeven = (stock: Stock) => {
  // Unified validation for both bank + stock payouts
  if (
    typeof stock.total_cost !== 'number' ||
    typeof stock.payout_value !== 'number' ||
    typeof stock.days_per_payout !== 'number' ||
    stock.payout_value <= 0 ||
    stock.days_per_payout <= 0
  ) {
    return null;
  }

  const { total_cost, payout_value, days_per_payout, total_received } = stock;

  const remaining = total_cost - (total_received || 0);
  if (remaining <= 0) return 0;

  const payoutsNeeded = Math.ceil(remaining / payout_value);
  return payoutsNeeded * days_per_payout;
};
// Unified card renderer for both bank + stock
const renderStockCard = (stock: Stock) => {
  const investor = stock.investors?.[0];
  const itemName =
    investor?.items?.length > 0
      ? investor.items.map((i) => i.name).join(', ')
      : investor?.item_name || '—';

  return (
    <View key={stock.id} style={styles.stockCard}>
      {/* HEADER */}
      <View style={styles.stockHeader}>
        <Text style={styles.stockName}>{stock.stock_name}</Text>

        {editMode && (
          <View style={styles.stockActions}>
            <TouchableOpacity
              onPress={() => openEditModal(stock)}
              style={styles.actionIcon}
            >
              <Ionicons name="create-outline" size={22} color="#2196f3" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleDeleteStock(stock.id, stock.stock_name)}
              style={styles.actionIcon}
            >
              <Ionicons name="trash-outline" size={20} color="#f44336" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* GRID */}
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

      {/* MONEY */}
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
          <Text style={styles.moneyLabel}>Payout Due</Text>
          <Text style={styles.moneyValue}>
            {stock.next_payout_due ? formatDateUK(stock.next_payout_due) : '—'}
          </Text>

          <Text
            style={[
              styles.roiText,
              stock.annualized_roi >= 0 ? styles.roiPositive : styles.roiNegative,
            ]}
          >
            ROI: {stock.annualized_roi >= 0 ? '+' : ''}
            {stock.annualized_roi}%
          </Text>

          {(() => {
            const daysToBreakeven = calculateDaysToBreakeven(stock);
            if (daysToBreakeven === null) return null;
            if (daysToBreakeven === 0)
              return <Text style={styles.breakevenText}>✓ Broken even!</Text>;

            return (
              <Text style={styles.breakevenText}>
                {daysToBreakeven} days to breakeven
              </Text>
            );
          })()}
        </View>

        <View style={styles.moneyItem}>
          <Text style={styles.moneyLabel}>Total Received</Text>
          <Text style={styles.moneyProfit}>
            {formatMoney(stock.total_received || 0)}
          </Text>
        </View>
      </View>

      {/* ITEM */}
      {itemName && (
        <View style={styles.buddyItemSection}>
          <Text style={styles.buddyItemText}>Item: {itemName}</Text>
        </View>
      )}

      {/* BUTTON */}
      <TouchableOpacity
        style={styles.viewPaymentsButton}
        onPress={() =>
          router.push({
            pathname: '/payment-schedule',
            params: { stockId: stock.id, stockName: stock.stock_name },
          })
        }
      >
        <Ionicons name="calendar-outline" size={20} color="#fff" />
        <Text style={styles.viewPaymentsText}>View Payment Schedule</Text>
        <Ionicons name="chevron-forward" size={20} color="#888" />
      </TouchableOpacity>
    </View>
  );
};
// Calculate overview stats (bank + stock fixed payouts)
const calculateOverview = () => {
  if (stocks.length === 0) return null;

  let totalCost = 0;
  let totalReceived = 0;
  let totalPayoutsReceived = 0;
  let weeklyPayout = 0;
  let roiSum = 0;

  const nextPayouts: Array<{ name: string; date: string }> = [];

  for (const s of stocks) {
    totalCost += s.total_cost;

    // ⭐ Include BOTH bank + stock fixed payouts
    totalReceived += s.total_received || 0;
    totalPayoutsReceived += s.payouts_received || 0;

    // Weekly payout (fixed payout every X days)
    if (s.days_per_payout > 0 && s.payout_value > 0) {
      const payoutsPerWeek = 7 / s.days_per_payout;
      weeklyPayout += s.payout_value * payoutsPerWeek;
    }

    // Next payout due
    if (s.next_payout_due) {
      nextPayouts.push({
        name: s.stock_name,
        date: s.next_payout_due,
      });
    }

    // ROI already computed per stock
    roiSum += s.annualized_roi || 0;
  }

  const avgRoi = roiSum / stocks.length;

  nextPayouts.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return {
    totalCost,
    totalReceived,
    totalPayoutsReceived,
    weeklyPayout,
    nextPayoutDue: nextPayouts[0] || null,
    avgRoi,
    totalStocks: stocks.length,
  };
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
          <TouchableOpacity
  onPress={exportData}
  style={styles.editModeButton}
>
  <Ionicons name="download-outline" size={24} color="#4caf50" />
</TouchableOpacity>
          <TouchableOpacity
            onPress={() => setEditMode(!editMode)}
            style={styles.editModeButton}
          >
            <Ionicons
              name={editMode ? 'create' : 'create-outline'}
              size={24}
              color={editMode ? '#ffc107' : '#888'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              resetForm();
              setModalVisible(true);
            }}
            style={styles.addButton}
          >
            <Ionicons name="add-circle" size={28} color="#4caf50" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4caf50" />
        }
      >
        {stocks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="trending-up-outline" size={64} color="#666" />
            <Text style={styles.emptyTitle}>No Stocks Yet</Text>
            <Text style={styles.emptyText}>
              Add your first stock investment to start tracking!
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setModalVisible(true)}
            >
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
                    <Text style={styles.overviewValueCost}>
                      {formatMoney(overview.totalCost)}
                    </Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Total Received</Text>
                    <Text style={styles.overviewValueProfit}>
                      {formatMoney(overview.totalReceived)}
                    </Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Payouts/Week</Text>
                    <Text style={styles.overviewValue}>
                      {formatMoney(overview.weeklyPayout)}
                    </Text>
                  </View>
                  <View style={styles.overviewItem}>
                    <Text style={styles.overviewLabel}>Avg ROI</Text>
                    <Text
                      style={[
                        styles.overviewValue,
                        overview.avgRoi >= 0 ? styles.roiPositive : styles.roiNegative,
                      ]}
                    >
                      {overview.avgRoi >= 0 ? '+' : ''}
                      {overview.avgRoi.toFixed(1)}%
                    </Text>
                  </View>
                </View>

                <View style={styles.overviewFooter}>
                  <View style={styles.overviewFooterItem}>
                    <Ionicons name="calendar-outline" size={16} color="#4caf50" />
                    <Text style={styles.overviewFooterLabel}>Next Payout:</Text>
                    {overview.nextPayoutDue ? (
                      <Text style={styles.overviewFooterValue}>
                        {overview.nextPayoutDue.name} -{' '}
                        {formatDateUK(overview.nextPayoutDue.date)}
                      </Text>
                    ) : (
                      <Text style={styles.overviewFooterValueMuted}>All caught up!</Text>
                    )}
                  </View>
                  <View style={styles.overviewFooterItem}>
                    <Ionicons name="checkmark-circle-outline" size={16} color="#4caf50" />
                    <Text style={styles.overviewFooterLabel}>Total Payouts:</Text>
                    <Text style={styles.overviewFooterValue}>
                      {overview.totalPayoutsReceived}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <Text style={styles.sectionTitle}>Your Investments ({stocks.length})</Text>

{stocks.map((stock) => renderStockCard(stock))}
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>

{/* Add/Edit Stock Modal */}
<Modal
  visible={modalVisible}
  animationType="slide"
  transparent={true}
  onRequestClose={() => setModalVisible(false)}
>
  <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    style={{ flex: 1 }}
  >
    <View style={styles.modalOverlay}>
      <View style={styles.modalContent}>

        {/* HEADER */}
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>
            {editingStock ? 'Edit' : 'Add'} Stock Investment
          </Text>
          <TouchableOpacity
            onPress={() => {
              setModalVisible(false);
              resetForm();
            }}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* BODY */}
        <ScrollView style={styles.modalBody}>

          {/* Buddy + ID */}
          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <Text style={styles.label}>Buddy Name</Text>
              <TextInput
                style={styles.input}
                value={stockName}
                onChangeText={setStockName}
                placeholder="e.g., JAK86"
                placeholderTextColor="#666"
              />
            </View>

            <View style={styles.inputHalf}>
              <Text style={styles.label}>Buddy ID</Text>
              <TextInput
                style={styles.input}
                value={buddyId}
                onChangeText={setBuddyId}
                placeholder="e.g., 3549633"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* PAYOUT TYPE */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Payout Type</Text>

            <View style={styles.selectorRow}>

              {/* BANK */}
              <TouchableOpacity
                style={[
                  styles.selectorOption,
                  payoutType === 'bank' && styles.selectorOptionActive,
                  isEditing && payoutType !== 'bank' && { opacity: 0.4 },
                ]}
                onPress={() => {
                  if (!isEditing) setPayoutType('bank');
                }}
              >
                <Text
                  style={[
                    styles.selectorOptionText,
                    payoutType === 'bank' && styles.selectorOptionTextActive,
                  ]}
                >
                  Bank (Variable)
                </Text>
              </TouchableOpacity>

              {/* STOCK */}
              <TouchableOpacity
                style={[
                  styles.selectorOption,
                  payoutType === 'stock' && styles.selectorOptionActive,
                  isEditing && payoutType !== 'stock' && { opacity: 0.4 },
                ]}
                onPress={() => {
                  if (!isEditing) setPayoutType('stock');
                }}
              >
                <Text
                  style={[
                    styles.selectorOptionText,
                    payoutType === 'stock' && styles.selectorOptionTextActive,
                  ]}
                >
                  Stock (Fixed)
                </Text>
              </TouchableOpacity>

            </View>
          </View>

          {/* EDITING WARNING */}
          {isEditing && (
            <Text style={{ color: '#ccc', marginTop: 5 }}>
              Payout type cannot be changed after creation.
            </Text>
          )}

          {/* START DATE */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="2026-01-01"
              placeholderTextColor="#666"
            />
          </View>

          {/* DAYS PER PAYOUT */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Days Per Payout</Text>
            <TextInput
              style={styles.input}
              value={daysPerPayout}
              onChangeText={setDaysPerPayout}
              placeholder="7"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
          </View>

          {/* TOTAL COST */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Total Cost</Text>
            <TextInput
              style={styles.input}
              value={totalCost}
              onChangeText={setTotalCost}
              placeholder="1000000"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
          </View>

          {/* PAYOUT VALUE */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Payout Value</Text>
            <TextInput
              style={styles.input}
              value={payoutValue}
              onChangeText={setPayoutValue}
              placeholder="150000"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
          </View>

          {/* BUDDY PAYMENT */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{stockName || 'Buddy'} Payment</Text>
            <TextInput
              style={styles.input}
              value={blankPayment}
              onChangeText={setBlankPayment}
              placeholder="50000"
              placeholderTextColor="#666"
              keyboardType="numeric"
            />
          </View>

          {/* ITEM NAMES */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Item Names (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={itemNames}
              onChangeText={setItemNames}
              placeholder="e.g., Drug Pack, Box of Medical Supplies"
              placeholderTextColor="#666"
            />
          </View>

          {/* SUBMIT BUTTON */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              submitting && styles.submitButtonDisabled,
            ]}
            onPress={handleAddOrEditStock}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name={
                    editingStock
                      ? 'checkmark-circle-outline'
                      : 'add-circle-outline'
                  }
                  size={20}
                  color="#fff"
                />
                <Text style={styles.submitButtonText}>
                  {editingStock ? 'Update' : 'Add'} Stock
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 60 }} />

</ScrollView>
</View>           
</View>               
</KeyboardAvoidingView>
</Modal>
<Modal
  visible={importExportModal}
  animationType="slide"
  transparent={true}
  onRequestClose={() => setImportExportModal(false)}
>
  <View style={styles.modalOverlay}>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.modalContent}>

        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Import / Export Data</Text>
          <TouchableOpacity onPress={() => setImportExportModal(false)}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody}>
          <Text style={styles.label}>Backup JSON</Text>
          <TextInput
            style={[styles.input, { height: 200, textAlignVertical: 'top' }]}
            multiline
            autoFocus={false}
            value={importText}
            onChangeText={setImportText}
            placeholder="Paste backup JSON here to import"
            placeholderTextColor="#666"
          />
        </ScrollView>

        <View style={{ padding: 20, paddingTop: 0 }}>
          <TouchableOpacity
            style={[styles.submitButton, { marginBottom: 10 }]}
            onPress={copyBackup}
          >
            <Text style={styles.submitButtonText}>Copy to Clipboard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, { marginBottom: 10 }]}
            onPress={saveBackup}
          >
            <Text style={styles.submitButtonText}>Save Backup</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, { marginBottom: 10 }]}
            onPress={loadBackup}
          >
            <Text style={styles.submitButtonText}>Load Backup</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: "#b00020" }]}
            onPress={clearAllData}
          >
            <Text style={styles.submitButtonText}>Clear All Data</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, { marginTop: 10 }]}
            onPress={importData}
          >
            <Text style={styles.submitButtonText}>Import</Text>
          </TouchableOpacity>
        </View>

      </View>
    </TouchableWithoutFeedback>
  </View>
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
    flex: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshButton: {
    padding: 8,
    marginRight: 4,
  },
  editModeButton: {
    padding: 8,
    marginRight: 4,
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
    color: '#ccc',
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
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
    color: '#ccc',
    marginBottom: 4,
  },
  moneyCost: {
    fontSize: 16,
    color: '#f44336',
    fontWeight: 'bold',
  },
  moneyValue: {
    fontSize: 16,
    color: '#fff',
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
  breakevenText: {
    fontSize: 11,
    color: '#ffc107',
    marginTop: 2,
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
  selectorRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  marginTop: 8,
},

selectorOption: {
  flex: 1,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: '#666',
  borderRadius: 6,
  marginRight: 8,
  alignItems: 'center',
},

selectorOptionActive: {
  backgroundColor: '#4caf50',
  borderColor: '#4caf50',
},

selectorOptionText: {
  color: '#ccc',
  fontSize: 14,
},

selectorOptionTextActive: {
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
