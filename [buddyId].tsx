// app/payment-schedule/[buddyId].tsx
// Payment Schedule page for a single buddy
// - Shows buddy summary (same info as buddy-stocks card)
// - Always displays next 5 payments (start date + daysPerPayout * n)
// - Mark payments as paid (manually) and persist to AsyncStorage
// - Detect payouts via Torn logs (money/item) but DO NOT auto-confirm payments
//   Instead: display a pretty detection message next to the payment and highlight the card
// - When confirming a payment, save the pretty detection message into the completed record (note)
// - Stores lastChecked per buddy so we only fetch logs after that timestamp
// - Uses SecureStore.getItemAsync('torn_api_key') to read the Torn API key
// - Includes optional money tolerance for matching
// - Past payouts now show both the original scheduled payout date and the date/time you marked it completed

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Pressable,
  Alert,
  Linking,
  ActivityIndicator,
  ScrollView,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";

/* ============================
   Config
   ============================ */

// Tolerance for money matching (units must match Torn money units and buddy.buddyPayout).
// Set to 0 for exact match. Increase if you want to allow small differences.
const MONEY_TOLERANCE = 0; // adjust as needed

/* ============================
   Theme & types
   ============================ */

const THEME = {
  background: "#07101a",
  surface: "#0b1226",
  card: "#0f1b2d",
  text: "#e6eef8",
  muted: "#9fb0d6",
  accent: "#1f6feb",
  success: "#2ecc71",
  danger: "#ff6b6b",
  infoBoxBg: "#081826",
  infoBoxBorder: "#123246",
  highlight: "#2b3f2a",
};

type InvestmentType = "stock" | "bank";

interface Detection {
  type: "money" | "item";
  logTimestamp: number; // unix seconds
  text: string; // pretty message to display
}

interface PaymentState {
  paymentNumber: number;
  amount: number; // cents or Torn money units (must be consistent)
  paid: boolean;
  paidDate?: string | null;
  note?: string | null; // saved pretty log when confirmed
  detection?: Detection | null; // detection info (not auto-confirm)
}

interface Buddy {
  id: string;
  buddyId: string;
  name: string;
  investmentType: InvestmentType;
  startDate?: string | null; // DD-MM-YYYY
  daysPerPayout: number;
  totalInvested: number; // cents
  payoutValue: number; // cents (to you)
  buddyPayout: number; // cents (to them)
  itemName?: string | null;
  totalPayouts: number;
  paymentsState?: Record<number, PaymentState>;
  version?: number;
  lastChecked?: number | null; // unix seconds timestamp for Torn log checks
}

/* ============================
   Storage key (shared with buddy-stocks)
   ============================ */

const STORAGE_KEY = "buddy:buddy-stocks:v1";

/* ============================
   Helpers (date, formatting)
   ============================ */

function parseDDMMYYYY(s?: string | null): Date | null {
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatCurrencyNoDecimals(value: number) {
  const dollars = Math.round(value / 100);
  return `$${Intl.NumberFormat("en-US").format(dollars)}`;
}

function formatCurrencyValueOnly(value: number) {
  const dollars = Math.round(value / 100);
  return Intl.NumberFormat("en-US").format(dollars);
}

function formatDateShort(d?: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString();
}

function formatTimeShortFromUnix(ts?: number | null) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString();
}

/* ============================
   Persistence helpers
   ============================ */

async function loadBuddies(): Promise<Buddy[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p: any) => normalizeAndRecompute(p));
  } catch (err) {
    console.warn("loadBuddies failed", err);
    return [];
  }
}

async function saveBuddies(buddies: Buddy[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buddies));
  } catch (err) {
    console.warn("saveBuddies failed", err);
    Alert.alert("Save failed", "Could not persist schedule changes.");
  }
}

/* ============================
   Normalization & recompute
   ============================ */

function toInt(v: unknown, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? fallback : n;
}
function toNumber(v: unknown, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAndRecompute(raw: any): Buddy {
  const b: Buddy = {
    id: String(raw?.id ?? raw?.buddyId ?? `b-${Date.now()}`),
    buddyId: String(raw?.buddyId ?? raw?.id ?? ""),
    name: String(raw?.name ?? raw?.buddyName ?? "Unnamed"),
    investmentType: (raw?.investmentType as InvestmentType) ?? "stock",
    startDate: raw?.startDate ?? null,
    daysPerPayout: toInt(raw?.daysPerPayout, 0),
    totalInvested: toNumber(raw?.totalInvested, 0),
    payoutValue: toNumber(raw?.payoutValue, 0),
    buddyPayout: toNumber(raw?.buddyPayout, 0),
    itemName: raw?.itemName ?? null,
    totalPayouts: toInt(raw?.totalPayouts, 0),
    paymentsState: raw?.paymentsState ?? {},
    version: toInt(raw?.version, 1),
    lastChecked: raw?.lastChecked ?? null,
  };

  b.paymentsState = b.paymentsState ?? {};
  const maxPayments = Math.max(1, b.totalPayouts || 1);
  for (let i = 1; i <= maxPayments; i++) {
    if (!b.paymentsState[i]) {
      b.paymentsState[i] = { paymentNumber: i, amount: Math.round(b.buddyPayout), paid: false, detection: null, note: null };
    } else {
      b.paymentsState[i].paymentNumber = i;
      b.paymentsState[i].amount = toNumber(b.paymentsState[i].amount, b.buddyPayout);
      b.paymentsState[i].detection = b.paymentsState[i].detection ?? null;
      b.paymentsState[i].note = b.paymentsState[i].note ?? null;
    }
  }

  return b;
}

/* ============================
   Migration: update stored payment amounts to buddyPayout
   ============================ */

async function migrateStoredPaymentAmounts() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    let changed = false;
    const migrated = parsed.map((rawBuddy: any) => {
      const buddyPayout = toNumber(rawBuddy?.buddyPayout, 0);
      if (!rawBuddy?.paymentsState) return rawBuddy;
      const ps = { ...rawBuddy.paymentsState };
      Object.keys(ps).forEach((k) => {
        const entry = ps[k];
        if (!entry) return;
        if ((entry.amount === undefined || entry.amount === null) && buddyPayout > 0) {
          ps[k] = { ...entry, amount: Math.round(buddyPayout) };
          changed = true;
        } else if (typeof entry.amount === "number" && buddyPayout > 0 && entry.amount !== Math.round(buddyPayout)) {
          ps[k] = { ...entry, amount: Math.round(buddyPayout) };
          changed = true;
        }
        ps[k].detection = ps[k].detection ?? null;
        ps[k].note = ps[k].note ?? null;
      });
      return { ...rawBuddy, paymentsState: ps };
    });

    if (changed) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      console.log("Migration: updated stored payment amounts to buddyPayout");
    } else {
      console.log("Migration: no changes needed");
    }
  } catch (err) {
    console.warn("Migration failed", err);
  }
}

/* ============================
   Torn detection helpers (async API key)
   ============================ */

const TORN_BASE_USER = "https://api.torn.com/user/";
const TORN_BASE_TORN = "https://api.torn.com/torn/";

// read Torn API key from SecureStore
async function getTornApiKeyAsync(): Promise<string | null> {
  try {
    const key = await SecureStore.getItemAsync("torn_api_key");
    return key ?? null;
  } catch (err) {
    console.warn("getTornApiKeyAsync error", err);
    return null;
  }
}

// fetch a specific Torn log (returns the 'log' object or null)
async function fetchTornLog(apiKey: string, logId: number) {
  try {
    const url = `${TORN_BASE_USER}?key=${encodeURIComponent(apiKey)}&log=${logId}&selections=log&comment=TornAPI`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Torn log fetch failed ${res.status}`);
    const json = await res.json();
    return json?.log ?? null;
  } catch (err) {
    console.warn("fetchTornLog error", err);
    return null;
  }
}

let _itemsCache: Record<string, any> | null = null;
async function fetchTornItems(apiKey: string) {
  if (_itemsCache) return _itemsCache;
  try {
    const url = `${TORN_BASE_TORN}?key=${encodeURIComponent(apiKey)}&selections=items&comment=TornAPI`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Torn items fetch failed ${res.status}`);
    const json = await res.json();
    _itemsCache = json?.items ?? null;
    return _itemsCache;
  } catch (err) {
    console.warn("fetchTornItems error", err);
    return null;
  }
}

async function resolveItemIdForBuddy(buddy: Buddy) {
  if (!buddy.itemName) return null;
  const apiKey = await getTornApiKeyAsync();
  if (!apiKey) return null;
  const items = await fetchTornItems(apiKey);
  if (!items) return null;
  const nameLower = String(buddy.itemName).trim().toLowerCase();
  for (const id of Object.keys(items)) {
    const meta = items[id];
    if (!meta?.name) continue;
    if (String(meta.name).trim().toLowerCase() === nameLower) return Number(id);
  }
  return null;
}

/**
 * Detect payouts for a buddy using Torn logs.
 * - Uses buddy.lastChecked (unix seconds) to only process newer logs.
 * - Falls back to last 72 hours if lastChecked is missing.
 * - Matches money logs (4810) by sender id and money amount (integer).
 * - Matches item logs (4103) by sender id and item id (resolved via Torn items).
 * - DOES NOT mark payments as paid. Instead it writes a detection message into paymentsState[p].detection
 * - Updates lastChecked to newest processed timestamp to avoid reprocessing.
 */
async function detectPayoutsForBuddy(buddy: Buddy) {
  const apiKey = await getTornApiKeyAsync();
  if (!apiKey) {
    throw new Error("Torn API key not available");
  }

  const now = Math.floor(Date.now() / 1000);
  const defaultSince = now - 72 * 3600;
  const since = buddy.lastChecked && buddy.lastChecked > 0 ? buddy.lastChecked : defaultSince;

  const updated = { ...buddy, paymentsState: { ...(buddy.paymentsState ?? {}) } };
  const matches: { type: "money" | "item"; paymentNumber: number; logTimestamp: number; text: string }[] = [];
  let newestTs = since;

  function findNextUnpaidPaymentNumber() {
    const max = Math.max(1, updated.totalPayouts || 1);
    for (let i = 1; i <= max; i++) {
      const ps = updated.paymentsState![i];
      if (!ps || !ps.paid) return i;
    }
    return null;
  }

  // Money logs (4810)
  const moneyLog = await fetchTornLog(apiKey, 4810);
  if (moneyLog) {
    for (const key of Object.keys(moneyLog)) {
      try {
        const entry = moneyLog[key];
        const ts = Number(entry.timestamp ?? 0);
        if (ts <= since) continue;
        const data = entry.data ?? {};
        const senderId = Number(data.sender ?? 0);
        const money = Number(data.money ?? 0); // Torn returns integer like 2000000
        if (senderId === Number(buddy.buddyId) && money > 0) {
          // Compare with tolerance
          if (Math.abs(money - Math.round(buddy.buddyPayout)) <= MONEY_TOLERANCE) {
            const nextPayment = findNextUnpaidPaymentNumber();
            if (nextPayment !== null) {
              const pretty = `${formatTimeShortFromUnix(ts)} - ${new Date(ts * 1000).toLocaleDateString()} ${buddy.name} sent ${formatCurrencyNoDecimals(money)} to you`;
              updated.paymentsState![nextPayment] = {
                ...(updated.paymentsState![nextPayment] ?? { paymentNumber: nextPayment, amount: money, paid: false, detection: null, note: null }),
                detection: { type: "money", logTimestamp: ts, text: pretty },
              };
              matches.push({ type: "money", paymentNumber: nextPayment, logTimestamp: ts, text: pretty });
              if (ts > newestTs) newestTs = ts;
            }
          }
        }
      } catch (err) {
        console.warn("moneyLog parse error", err);
      }
    }
  }

  // Item logs (4103)
  const itemLog = await fetchTornLog(apiKey, 4103);
  if (itemLog) {
    const itemIdForBuddy = await resolveItemIdForBuddy(buddy);
    if (itemIdForBuddy !== null) {
      for (const key of Object.keys(itemLog)) {
        try {
          const entry = itemLog[key];
          const ts = Number(entry.timestamp ?? 0);
          if (ts <= since) continue;
          const data = entry.data ?? {};
          const senderId = Number(data.sender ?? 0);
          const items = Array.isArray(data.items) ? data.items : [];
          const found = items.find((it: any) => Number(it.id) === itemIdForBuddy);
          if (found && senderId === Number(buddy.buddyId)) {
            const nextPayment = findNextUnpaidPaymentNumber();
            if (nextPayment !== null) {
              const pretty = `${formatTimeShortFromUnix(ts)} - ${new Date(ts * 1000).toLocaleDateString()} ${buddy.name} sent a ${buddy.itemName} to you`;
              updated.paymentsState![nextPayment] = {
                ...(updated.paymentsState![nextPayment] ?? { paymentNumber: nextPayment, amount: Math.round(buddy.buddyPayout), paid: false, detection: null, note: null }),
                detection: { type: "item", logTimestamp: ts, text: pretty },
              };
              matches.push({ type: "item", paymentNumber: nextPayment, logTimestamp: ts, text: pretty });
              if (ts > newestTs) newestTs = ts;
            }
          }
        } catch (err) {
          console.warn("itemLog parse error", err);
        }
      }
    }
  }

  // If matches found, update lastChecked to newestTs + 1 and persist detection messages
  if (matches.length > 0) {
    updated.lastChecked = newestTs + 1;
    const all = await loadBuddies();
    const nextAll = all.map((b) => (b.id === updated.id ? normalizeAndRecompute(updated) : b));
    await saveBuddies(nextAll);
    return { updatedBuddy: normalizeAndRecompute(updated), matches };
  }

  // No matches: update lastChecked to now if it was missing (avoid re-scanning same window)
  if (!buddy.lastChecked) {
    const all = await loadBuddies();
    const nextAll = all.map((b) => (b.id === buddy.id ? { ...b, lastChecked: now } : b));
    await saveBuddies(nextAll);
    return { updatedBuddy: { ...buddy, lastChecked: now }, matches: [] };
  }

  return { updatedBuddy: buddy, matches: [] };
}

/* ============================
   Payment generation & helpers
   ============================ */

function generatePaymentsForBuddy(buddy: Buddy, count = 5) {
  const payments: { paymentNumber: number; date: Date | null; amount: number; paid: boolean; detection?: Detection | null }[] = [];
  const start = parseDDMMYYYY(buddy.startDate ?? null);
  const days = Math.max(0, buddy.daysPerPayout);
  const total = Math.max(1, buddy.totalPayouts || 1);

  for (let i = 1; i <= total; i++) {
    const date = start ? new Date(start.getTime()) : null;
    if (date) date.setDate(date.getDate() + (i - 1) * days);
    const state = buddy.paymentsState?.[i];
    payments.push({
      paymentNumber: i,
      date,
      amount: state ? state.amount : Math.round(buddy.buddyPayout),
      paid: state ? !!state.paid : false,
      detection: state ? state.detection ?? null : null,
    });
  }

  const firstUnpaidIndex = payments.findIndex((p) => !p.paid);
  const startIndex = firstUnpaidIndex === -1 ? Math.max(0, payments.length - count) : firstUnpaidIndex;
  const slice = payments.slice(startIndex, startIndex + count);
  return slice;
}

/**
 * getPastPayments now returns:
 * - paymentNumber
 * - amount
 * - paidDate (when you marked it completed)
 * - scheduledDate (the original scheduled payout date based on startDate + daysPerPayout)
 * - note (saved pretty detection message if any)
 */
function getPastPayments(buddy: Buddy) {
  const entries: { paymentNumber: number; amount: number; paidDate?: string | null; scheduledDate?: string | null; note?: string | null }[] = [];
  const ps = buddy.paymentsState ?? {};
  const start = parseDDMMYYYY(buddy.startDate ?? null);
  const days = Math.max(0, buddy.daysPerPayout);
  Object.keys(ps).forEach((k) => {
    const p = ps[Number(k)];
    if (p && p.paid) {
      // compute scheduled date for this payment number
      let scheduled: string | null = null;
      if (start) {
        const d = new Date(start.getTime());
        d.setDate(d.getDate() + (p.paymentNumber - 1) * days);
        scheduled = d.toISOString();
      }
      entries.push({
        paymentNumber: p.paymentNumber,
        amount: p.amount,
        paidDate: p.paidDate ?? null,
        scheduledDate: scheduled,
        note: p.note ?? null,
      });
    }
  });
  entries.sort((a, b) => {
    const ta = a.paidDate ? new Date(a.paidDate).getTime() : 0;
    const tb = b.paidDate ? new Date(b.paidDate).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return b.paymentNumber - a.paymentNumber;
  });
  return entries;
}

/* ============================
   Component
   ============================ */

export default function PaymentSchedulePage() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const buddyIdParam = String(params?.buddyId ?? "");
  const [loading, setLoading] = useState(true);
  const [buddy, setBuddy] = useState<Buddy | null>(null);
  const [allBuddies, setAllBuddies] = useState<Buddy[]>([]);
  const [payments, setPayments] = useState<{ paymentNumber: number; date: Date | null; amount: number; paid: boolean; detection?: Detection | null }[]>([]);
  const [pastModalOpen, setPastModalOpen] = useState(false);
  const [pastPayments, setPastPayments] = useState<{ paymentNumber: number; amount: number; paidDate?: string | null; scheduledDate?: string | null; note?: string | null }[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await migrateStoredPaymentAmounts();
      const loaded = await loadBuddies();
      setAllBuddies(loaded);
      const found = loaded.find((b) => String(b.id) === buddyIdParam || String(b.buddyId) === buddyIdParam);
      if (!found) {
        setBuddy(null);
        setPayments([]);
        setLoading(false);
        return;
      }
      setBuddy(found);
      setPayments(generatePaymentsForBuddy(found, 5));
      setPastPayments(getPastPayments(found));
      setLoading(false);
    })();
  }, [buddyIdParam]);

  const persistBuddyChange = useCallback(
    async (updated: Buddy) => {
      const next = allBuddies.map((b) => (b.id === updated.id ? updated : b));
      await saveBuddies(next);
      setAllBuddies(next);
      setBuddy(updated);
      setPayments(generatePaymentsForBuddy(updated, 5));
      setPastPayments(getPastPayments(updated));
    },
    [allBuddies]
  );

  // Mark payment and save detection text into note when confirming
  const markPayment = useCallback(
    async (paymentNumber: number, paid: boolean) => {
      if (!buddy) return;
      const updated = { ...buddy, paymentsState: { ...(buddy.paymentsState ?? {}) } };
      const existing = updated.paymentsState![paymentNumber] ?? {
        paymentNumber,
        amount: Math.round(updated.buddyPayout),
        paid: false,
        detection: null,
        note: null,
      };

      if (paid) {
        existing.paid = true;
        existing.paidDate = new Date().toISOString();
        // If there is a detection message, save it into note and clear detection
        if (existing.detection && existing.detection.text) {
          existing.note = existing.detection.text;
          existing.detection = null;
        }
      } else {
        // unmarking: keep note/detection as-is (or clear if you prefer)
        existing.paid = false;
        existing.paidDate = null;
      }

      updated.paymentsState![paymentNumber] = existing;
      await persistBuddyChange(updated);
    },
    [buddy, persistBuddyChange]
  );

  const copyAndOpenProfile = useCallback(
    async () => {
      if (!buddy) return;
      const valueOnly = formatCurrencyValueOnly(buddy.buddyPayout);
      await Clipboard.setStringAsync(valueOnly);
      const id = buddy.buddyId || buddy.id;
      const url = `https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`;
      Linking.openURL(url).catch(() => Alert.alert("Open failed", "Could not open profile URL."));
      Alert.alert("Copied", `${valueOnly} copied to clipboard`);
    },
    [buddy]
  );

  const openPastModal = useCallback(() => {
    if (!buddy) return;
    setPastPayments(getPastPayments(buddy));
    setPastModalOpen(true);
  }, [buddy]);

  const unmarkPastPayment = useCallback(
    async (paymentNumber: number) => {
      await markPayment(paymentNumber, false);
      const loaded = await loadBuddies();
      const updated = loaded.find((b) => b.id === buddy?.id) ?? buddy;
      setBuddy(updated);
      setPayments(generatePaymentsForBuddy(updated, 5));
      setPastPayments(getPastPayments(updated));
    },
    [buddy, markPayment]
  );

  const handleDetectPayoutsButton = useCallback(async () => {
    if (!buddy) return;
    try {
      setLoading(true);
      const res = await detectPayoutsForBuddy(buddy);
      if (res.matches && res.matches.length > 0) {
        const loaded = await loadBuddies();
        const updated = loaded.find((b) => b.id === buddy.id) ?? res.updatedBuddy;
        setBuddy(updated);
        setPayments(generatePaymentsForBuddy(updated, 5));
        setPastPayments(getPastPayments(updated));
        Alert.alert("Detections", `Found ${res.matches.length} matching log(s). They are shown on the schedule but not confirmed.`);
      } else {
        const loaded = await loadBuddies();
        const updated = loaded.find((b) => b.id === buddy.id) ?? buddy;
        setBuddy(updated);
        setPayments(generatePaymentsForBuddy(updated, 5));
        setPastPayments(getPastPayments(updated));
        Alert.alert("No detections", "No matching logs found in the checked window.");
      }
    } catch (err) {
      console.warn("detect payouts error", err);
      Alert.alert("Error", "Could not check Torn logs. Check API key and network.");
    } finally {
      setLoading(false);
    }
  }, [buddy]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={THEME.accent} />
          <Text style={{ color: THEME.text, marginTop: 8 }}>Loading schedule…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!buddy) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Payment Schedule</Text>
        </View>
        <View style={{ padding: 16 }}>
          <Text style={{ color: THEME.muted }}>Buddy not found. Go back and select a buddy.</Text>
          <View style={{ height: 12 }} />
          <Pressable style={[styles.btn, { backgroundColor: THEME.accent }]} onPress={() => router.back()}>
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.header}>
          <Text style={styles.title}>Payment Schedule</Text>
          <Text style={styles.subtitle}>{buddy.name}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{buddy.name}</Text>
            <Text style={styles.cardSub}>{buddy.investmentType.toUpperCase()}</Text>
          </View>

          <View style={styles.cardBody}>
            <View style={{ flex: 1 }}>
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Buddy ID</Text> {buddy.buddyId || "—"}
              </Text>
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Start date</Text> {buddy.startDate || "—"}
              </Text>
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Days per payout</Text> {buddy.daysPerPayout || "—"}
              </Text>
              <Text style={styles.field}>
                <Text style={styles.fieldLabel}>Item name</Text> {buddy.itemName || "—"}
              </Text>
            </View>

            <View style={styles.infoBox}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Invested</Text>
                <Text style={styles.infoValue}>{formatCurrencyNoDecimals(buddy.totalInvested)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Payout</Text>
                <Text style={styles.infoValue}>{formatCurrencyNoDecimals(buddy.payoutValue)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{`${buddy.name} payout`}</Text>
                <Text style={styles.infoValue}>{formatCurrencyNoDecimals(buddy.buddyPayout)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Next payout</Text>
                <Text style={styles.infoValue}>{formatDateShort(generatePaymentsForBuddy(buddy, 1)[0]?.date ?? null)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sectionTitle}>Next 5 payments</Text>
            <Pressable style={[styles.smallBtn, { backgroundColor: "#223a55" }]} onPress={openPastModal}>
              <Text style={styles.smallBtnText}>View past payouts</Text>
            </Pressable>
          </View>

          <FlatList
            data={payments}
            keyExtractor={(p) => String(p.paymentNumber)}
            renderItem={({ item }) => {
              const highlighted = !!item.detection && !item.paid;
              return (
                <View style={[styles.paymentCard, highlighted ? styles.paymentCardHighlighted : null]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paymentHeader}>#{item.paymentNumber} • {item.date ? item.date.toLocaleDateString() : "TBD"}</Text>
                    <Text style={styles.paymentSub}>{formatCurrencyNoDecimals(item.amount)} • {item.paid ? `Paid` : `Pending`}</Text>
                    {item.detection ? (
                      <Text style={styles.detectionText}>{item.detection.text}</Text>
                    ) : null}
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Pressable
                      style={[styles.smallBtn, { backgroundColor: THEME.accent, marginBottom: 8 }]}
                      onPress={() => copyAndOpenProfile()}
                    >
                      <Text style={[styles.smallBtnText, { color: "#fff" }]}>Copy & Open</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.smallBtn, { backgroundColor: item.paid ? "#444" : THEME.success }]}
                      onPress={() =>
                        Alert.alert(item.paid ? "Unmark payment" : "Mark payment as paid", `Payment #${item.paymentNumber}`, [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: item.paid ? "Unmark" : "Mark as paid",
                            onPress: async () => {
                              await markPayment(item.paymentNumber, !item.paid);
                              const loaded = await loadBuddies();
                              const updated = loaded.find((b) => b.id === buddy.id) ?? buddy;
                              setBuddy(updated);
                              setPayments(generatePaymentsForBuddy(updated, 5));
                              setPastPayments(getPastPayments(updated));
                            },
                            style: "default",
                          },
                        ])
                      }
                    >
                      <Text style={styles.smallBtnText}>{item.paid ? "Unmark" : "Mark paid"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={<Text style={{ color: THEME.muted, padding: 12 }}>No upcoming payments</Text>}
            scrollEnabled={false}
          />

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Pressable style={[styles.btn, { backgroundColor: THEME.accent }]} onPress={async () => {
              const loaded = await loadBuddies();
              const updated = loaded.find((b) => b.id === buddy.id) ?? buddy;
              setBuddy(updated);
              setPayments(generatePaymentsForBuddy(updated, 5));
              setPastPayments(getPastPayments(updated));
            }}>
              <Text style={styles.btnText}>Refresh</Text>
            </Pressable>

            <Pressable style={[styles.btn, { backgroundColor: "#1f8a4d" }]} onPress={handleDetectPayoutsButton}>
              <Text style={styles.btnText}>Detect payouts</Text>
            </Pressable>

            <Pressable style={[styles.btn, { backgroundColor: "#2b394f" }]} onPress={() => router.back()}>
              <Text style={styles.btnText}>Back</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={pastModalOpen} animationType="slide" onRequestClose={() => setPastModalOpen(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
          <View style={{ padding: 16 }}>
            <Text style={{ color: THEME.text, fontSize: 18, fontWeight: "700" }}>Past payouts</Text>
            <Text style={{ color: THEME.muted, marginTop: 6 }}>{buddy.name} — completed payouts</Text>
          </View>

          <FlatList
            data={pastPayments}
            keyExtractor={(p) => String(p.paymentNumber)}
            contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => (
              <View style={[styles.paymentCard, { justifyContent: "space-between" }]}>
                <View>
                  <Text style={styles.paymentHeader}>#{item.paymentNumber}</Text>
                  <Text style={styles.paymentSub}>
                    {formatCurrencyNoDecimals(item.amount)}
                  </Text>

                  <Text style={{ color: THEME.muted, marginTop: 6, fontSize: 12 }}>
                    <Text style={{ color: THEME.muted, fontWeight: "700" }}>Scheduled: </Text>
                    {item.scheduledDate ? new Date(item.scheduledDate).toLocaleString() : "—"}
                  </Text>

                  <Text style={{ color: THEME.muted, marginTop: 4, fontSize: 12 }}>
                    <Text style={{ color: THEME.muted, fontWeight: "700" }}>Completed: </Text>
                    {item.paidDate ? new Date(item.paidDate).toLocaleString() : "—"}
                  </Text>

                  {item.note ? <Text style={styles.pastNoteText}>{item.note}</Text> : null}
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: "#444", marginBottom: 8 }]}
                    onPress={() => {
                      copyAndOpenProfile();
                    }}
                  >
                    <Text style={[styles.smallBtnText, { color: "#fff" }]}>Copy & Open</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: THEME.danger }]}
                    onPress={() =>
                      Alert.alert("Unmark payout", `Unmark payment #${item.paymentNumber} as paid?`, [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Unmark",
                          style: "destructive",
                          onPress: async () => {
                            await unmarkPastPayment(item.paymentNumber);
                          },
                        },
                      ])
                    }
                  >
                    <Text style={styles.smallBtnText}>Unmark</Text>
                  </Pressable>
                </View>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={<Text style={{ color: THEME.muted, padding: 12 }}>No completed payouts yet</Text>}
          />

          <View style={{ padding: 12, flexDirection: "row", justifyContent: "space-between" }}>
            <Pressable style={[styles.btn, { backgroundColor: "#2b394f" }]} onPress={() => setPastModalOpen(false)}>
              <Text style={styles.btnText}>Close</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: THEME.accent }]}
              onPress={async () => {
                const loaded = await loadBuddies();
                const updated = loaded.find((b) => b.id === buddy.id) ?? buddy;
                setBuddy(updated);
                setPayments(generatePaymentsForBuddy(updated, 5));
                setPastPayments(getPastPayments(updated));
              }}
            >
              <Text style={styles.btnText}>Refresh</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/* ============================
   Styles
   ============================ */

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { padding: 12 },
  title: { color: THEME.text, fontSize: 20, fontWeight: "700" },
  subtitle: { color: THEME.muted, marginTop: 4 },
  card: { margin: 12, backgroundColor: THEME.card, borderRadius: 10, padding: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardTitle: { color: THEME.text, fontWeight: "700", fontSize: 16 },
  cardSub: { color: THEME.muted, fontSize: 12 },
  cardBody: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  field: { color: THEME.text, marginBottom: 4 },
  fieldLabel: { color: THEME.muted, fontWeight: "700" },
  infoBox: {
    width: 160,
    backgroundColor: THEME.infoBoxBg,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: THEME.infoBoxBorder,
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  infoLabel: { color: THEME.muted, fontSize: 12, flex: 1 },
  infoValue: { color: THEME.text, fontWeight: "700", textAlign: "right", marginLeft: 8 },
  sectionTitle: { color: THEME.text, fontWeight: "700", marginBottom: 8, marginTop: 6 },
  paymentCard: { backgroundColor: THEME.surface, padding: 12, borderRadius: 8, flexDirection: "row", alignItems: "center" },
  paymentCardHighlighted: { backgroundColor: THEME.highlight, borderWidth: 1, borderColor: "#9fbf9a" },
  paymentHeader: { color: THEME.text, fontWeight: "700" },
  paymentSub: { color: THEME.muted, marginTop: 4 },
  detectionText: { color: "#ffd86b", marginTop: 6, fontSize: 12 },
  pastNoteText: { color: "#ffd86b", marginTop: 6, fontSize: 12 },
  smallBtn: {
    minWidth: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#122033",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: {
    color: THEME.text,
    fontSize: 12,
    textAlign: "center",
    fontWeight: "700",
  },
  btn: { padding: 12, borderRadius: 8, alignItems: "center", minWidth: 100 },
  btnText: { color: "#fff", fontWeight: "700" },
});
