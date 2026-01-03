import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [currentKeyPreview, setCurrentKeyPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkCurrentKey();
  }, []);

  const checkCurrentKey = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/settings/api-key`);
      if (response.data.has_key) {
        setCurrentKeyPreview(response.data.key_preview);
      }
    } catch (error) {
      console.log('Error checking key:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert('Error', 'Please enter your API key');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/settings/api-key`, {
        api_key: apiKey.trim(),
      });

      if (response.data.success) {
        Alert.alert('Success', 'API key updated successfully!', [
          {
            text: 'OK',
            onPress: () => {
              setApiKey('');
              checkCurrentKey();
            },
          },
        ]);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Failed to save API key. Please check your key and try again.';
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#d32f2f" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          {currentKeyPreview && (
            <View style={styles.currentKeyCard}>
              <View style={styles.currentKeyHeader}>
                <Ionicons name="key-outline" size={20} color="#4caf50" />
                <Text style={styles.currentKeyTitle}>Current API Key</Text>
              </View>
              <Text style={styles.currentKeyValue}>{currentKeyPreview}</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Update API Key</Text>
            <Text style={styles.sectionDescription}>
              Enter a new Torn.com API key to update your configuration.
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>New API Key</Text>
              <TextInput
                style={styles.input}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Enter your new API key"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSaveKey}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="save-outline" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Save API Key</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>How to get your API key:</Text>
            <Text style={styles.infoText}>1. Go to www.torn.com</Text>
            <Text style={styles.infoText}>2. Navigate to Preferences → API</Text>
            <Text style={styles.infoText}>3. Create or copy an existing API key</Text>
            <Text style={styles.infoText}>4. Paste it here</Text>
          </View>

          <TouchableOpacity
            style={styles.dashboardButton}
            onPress={() => router.push('/dashboard')}
          >
            <Ionicons name="speedometer-outline" size={20} color="#2196f3" />
            <Text style={styles.dashboardButtonText}>Go to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  currentKeyCard: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#4caf50',
  },
  currentKeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  currentKeyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4caf50',
    marginLeft: 8,
  },
  currentKeyValue: {
    fontSize: 18,
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 16,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    color: '#fff',
  },
  button: {
    backgroundColor: '#d32f2f',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  infoBox: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 16,
    color: '#2196f3',
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 6,
  },
  loadingText: {
    color: '#aaa',
    marginTop: 10,
    fontSize: 16,
  },
  dashboardButton: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#2196f3',
  },
  dashboardButtonText: {
    color: '#2196f3',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
