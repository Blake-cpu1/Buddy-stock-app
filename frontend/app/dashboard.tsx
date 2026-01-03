import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

interface DashboardData {
  profile: {
    player_id: number;
    name: string;
    level: number;
    rank: string;
    gender: string;
    status: any;
  };
  bars: {
    energy: { current: number; maximum: number };
    nerve: { current: number; maximum: number };
    happy: { current: number; maximum: number };
    life: { current: number; maximum: number };
  };
  money: {
    cash: number;
    points: number;
    bank: number;
  };
  battle_stats: {
    strength: number;
    defense: number;
    speed: number;
    dexterity: number;
    total: number;
  };
  cooldowns: any;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/user/dashboard`);
      setData(response.data);
    } catch (error: any) {
      console.error('Error fetching dashboard:', error);
      if (error.response?.status === 400) {
        Alert.alert(
          'API Key Required',
          'Please configure your API key in settings.',
          [
            {
              text: 'Go to Settings',
              onPress: () => router.push('/settings'),
            },
          ]
        );
      } else {
        Alert.alert('Error', 'Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDashboardData();
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `$${(num / 1000).toFixed(1)}K`;
    }
    return `$${num.toLocaleString()}`;
  };

  const renderProgressBar = (label: string, current: number, maximum: number, color: string) => {
    const percentage = maximum > 0 ? (current / maximum) * 100 : 0;
    return (
      <View style={styles.barContainer}>
        <View style={styles.barHeader}>
          <Text style={styles.barLabel}>{label}</Text>
          <Text style={styles.barValue}>
            {current} / {maximum}
          </Text>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${percentage}%`, backgroundColor: color }]} />
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#d32f2f" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Failed to load data</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchDashboardData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSubtitle}>{data.profile.name}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d32f2f" />}
      >
        {/* Profile Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-circle-outline" size={24} color="#d32f2f" />
            <Text style={styles.cardTitle}>Profile</Text>
          </View>
          <View style={styles.profileGrid}>
            <View style={styles.profileItem}>
              <Text style={styles.profileLabel}>Level</Text>
              <Text style={styles.profileValue}>{data.profile.level}</Text>
            </View>
            <View style={styles.profileItem}>
              <Text style={styles.profileLabel}>Rank</Text>
              <Text style={styles.profileValue}>{data.profile.rank}</Text>
            </View>
            <View style={styles.profileItem}>
              <Text style={styles.profileLabel}>ID</Text>
              <Text style={styles.profileValue}>{data.profile.player_id}</Text>
            </View>
          </View>
        </View>

        {/* Money Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="cash-outline" size={24} color="#4caf50" />
            <Text style={styles.cardTitle}>Money</Text>
          </View>
          <View style={styles.moneyGrid}>
            <View style={styles.moneyItem}>
              <Text style={styles.moneyLabel}>Cash</Text>
              <Text style={styles.moneyValue}>{formatNumber(data.money.cash)}</Text>
            </View>
            <View style={styles.moneyItem}>
              <Text style={styles.moneyLabel}>Bank</Text>
              <Text style={styles.moneyValue}>{formatNumber(data.money.bank)}</Text>
            </View>
            <View style={styles.moneyItem}>
              <Text style={styles.moneyLabel}>Points</Text>
              <Text style={styles.moneyValue}>{data.money.points.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        {/* Status Bars Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="stats-chart-outline" size={24} color="#2196f3" />
            <Text style={styles.cardTitle}>Status Bars</Text>
          </View>
          {renderProgressBar('Energy', data.bars.energy.current, data.bars.energy.maximum, '#4caf50')}
          {renderProgressBar('Nerve', data.bars.nerve.current, data.bars.nerve.maximum, '#ff9800')}
          {renderProgressBar('Happy', data.bars.happy.current, data.bars.happy.maximum, '#e91e63')}
          {renderProgressBar('Life', data.bars.life.current, data.bars.life.maximum, '#f44336')}
        </View>

        {/* Battle Stats Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="shield-outline" size={24} color="#9c27b0" />
            <Text style={styles.cardTitle}>Battle Stats</Text>
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Strength</Text>
              <Text style={styles.statValue}>{data.battle_stats.strength.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Defense</Text>
              <Text style={styles.statValue}>{data.battle_stats.defense.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Speed</Text>
              <Text style={styles.statValue}>{data.battle_stats.speed.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Dexterity</Text>
              <Text style={styles.statValue}>{data.battle_stats.dexterity.toLocaleString()}</Text>
            </View>
          </View>
          <View style={styles.totalStats}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{data.battle_stats.total.toLocaleString()}</Text>
          </View>
        </View>

        {/* Quick Actions Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="apps-outline" size={24} color="#00bcd4" />
            <Text style={styles.cardTitle}>Quick Actions</Text>
          </View>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push('/buddy-stocks')}
          >
            <Ionicons name="cube" size={24} color="#4caf50" />
            <Text style={styles.actionButtonText}>Buddy Stocks</Text>
            <Ionicons name="chevron-forward" size={20} color="#888" />
          </TouchableOpacity>
        </View>
              <Text style={styles.statValue}>{data.battle_stats.defense.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Speed</Text>
              <Text style={styles.statValue}>{data.battle_stats.speed.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Dexterity</Text>
              <Text style={styles.statValue}>{data.battle_stats.dexterity.toLocaleString()}</Text>
            </View>
          </View>
          <View style={styles.totalStats}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{data.battle_stats.total.toLocaleString()}</Text>
          </View>
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
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#888',
    marginTop: 4,
  },
  settingsButton: {
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
  errorContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#f44336',
    fontSize: 18,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#d32f2f',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1a1a1a',
    marginHorizontal: 20,
    marginTop: 20,
    borderRadius: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 8,
  },
  profileGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  profileItem: {
    flex: 1,
    alignItems: 'center',
  },
  profileLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  profileValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  moneyGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  moneyItem: {
    flex: 1,
    alignItems: 'center',
  },
  moneyLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  moneyValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4caf50',
  },
  barContainer: {
    marginBottom: 16,
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  barLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  barValue: {
    fontSize: 14,
    color: '#888',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '48%',
    backgroundColor: '#252525',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  totalStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#252525',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    color: '#888',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#9c27b0',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252525',
    padding: 16,
    borderRadius: 8,
    marginTop: 8,
  },
  actionButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 12,
  },
});
