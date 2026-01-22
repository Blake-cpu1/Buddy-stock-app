// app/buddy-stocks.tsx
// Buddy Stocks main screen
// - Portfolio overview (total invested, total received, payouts/week, avg ROI, next payout(s))
// - Buddy cards with requested fields and computed next payout, ROI, days to break even
// - Add / Edit modal for investments
// - Uses AsyncStorage for persistence
// - FlatList used as root to avoid nested VirtualizedList warning
// - Accepts short numeric suffixes: k, M, B, T (case-insensitive)
// - Card right column wrapped into a neat info box
// - Each card includes a Schedule button that navigates to /payment-schedule/[buddyId]

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  Button,
  Alert,
  SafeAreaView,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";

/* ============================
   Theme and types
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
  inputBg: "#0b1226",
  inputBorder: "#22324a",
  infoBoxBg: "#081826",
  infoBoxBorder: "#123246",
};

type InvestmentType = "stock" | "bank";

interface PaymentState {
  paymentNumber: number;
  amount: number;
  paid: boolean;
  paidDate?: string | null;
  note?: string | null;
}

interface Buddy {
  id: string;
  buddyId: string;
  name: string;
  investmentType: InvestmentType;
  startDate?: string | null;
  daysPerPayout: number;
  totalInvested: number; // cents
  payoutValue: number; // cents
  buddyPayout: number; // cents
  itemName?: string | null;
  totalPayouts: number;
  paymentsState?: Record<number, PaymentState>;
  version?: number;
}

/* ============================
   Persistence key
   ============================ */

const STORAGE_KEY = "buddy:buddy-stocks:v1";

/* ============================
   Utility helpers (hoisted)
   ============================ */

function uid(prefix = "b") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

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

/* ============================
   Suffix-aware parsing
   ============================ */

function parseSuffixNumber(input: string | number | undefined): number {
  if (input === undefined || input === null) return 0;
  const s = String(input).trim();
  if (s === "") return 0;

  const plainNumberMatch = s.match(/^(-?\d+(\.\d+)?)$/);
  if (plainNumberMatch) {
    const n = Number(plainNumberMatch[1]);
    return Number.isFinite(n) ? n : 0;
  }

  const match = s.replace(/,/g, "").match(/^(-?\d+(\.\d+)?)([kKmMbBtT])?$/);
  if (!match) {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  const numPart = Number(match[1]);
  const suffix = match[3]?.toLowerCase();

  if (!suffix) return Math.round(numPart);

  switch (suffix) {
    case "k":
      return Math.round(numPart * 1_000);
    case "m":
      return Math.round(numPart * 1_000_000);
    case "b":
      return Math.round(numPart * 1_000_000_000);
    case "t":
      return Math.round(numPart * 1_000_000_000_000);
    default:
      return Math.round(numPart);
  }
}

function parseCurrencyInput(input: string | number | undefined): number {
  if (input === undefined || input === null) return 0;
  if (typeof input === "number") {
    return Math.round(input * 100);
  }
  const s = String(input).trim();
  if (s === "") return 0;

  if (s.includes(".")) {
    const n = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  const whole = parseSuffixNumber(s);
  return Math.round(whole * 100);
}

/* ============================
   Normalize and recompute
   ============================ */

function normalizeBuddy(raw: any): Buddy {
  return {
    id: String(raw?.id ?? uid("b")),
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
  };
}

function recomputeBuddy(buddy: Buddy): Buddy {
  const b = { ...buddy };
  b.daysPerPayout = toInt(b.daysPerPayout, 0);
  b.totalInvested = toNumber(b.totalInvested, 0);
  b.payoutValue = toNumber(b.payoutValue, 0);
  b.buddyPayout = toNumber(b.buddyPayout, 0);
  b.totalPayouts = toInt(b.totalPayouts, 0);
  b.paymentsState = b.paymentsState ?? {};
  const maxPayments = Math.max(1, b.totalPayouts || 1);
  for (let i = 1; i <= maxPayments; i++) {
    if (!b.paymentsState[i]) {
      b.paymentsState[i] = { paymentNumber: i, amount: Math.round(b.payoutValue), paid: false };
    } else {
      b.paymentsState[i].paymentNumber = i;
      b.paymentsState[i].amount = toNumber(b.paymentsState[i].amount, b.payoutValue);
    }
  }
  return b;
}

/* ============================
   ROI and schedule helpers
   ============================ */

function computeBuddyROI(buddy: Buddy) {
  const b = recomputeBuddy(buddy);
  const received = Object.values(b.paymentsState ?? {}).reduce((s, p) => s + (p.paid ? p.amount : 0), 0);
  const invested = b.totalInvested;
  const roi = invested === 0 ? 0 : (received - invested) / invested;
  return { invested, received, roi };
}

function nextPayoutDate(buddy: Buddy) {
  const b = recomputeBuddy(buddy);
  const start = parseDDMMYYYY(b.startDate ?? null);
  if (!start || b.daysPerPayout <= 0) return null;
  const next = new Date(start.getTime());
  next.setDate(next.getDate() + b.daysPerPayout);
  return next;
}

function daysUntilBreakEven(buddy: Buddy) {
  const b = recomputeBuddy(buddy);
  const invested = b.totalInvested;
  if (invested <= 0) return null;
  let cumulative = 0;
  const start = parseDDMMYYYY(b.startDate ?? null);
  for (let i = 1; i <= Math.max(1, b.totalPayouts || 100); i++) {
    cumulative += Math.round(b.payoutValue);
    if (cumulative >= invested) {
      if (!start || b.daysPerPayout <= 0) return null;
      const date = new Date(start.getTime());
      date.setDate(date.getDate() + i * b.daysPerPayout);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      return days;
    }
  }
  return null;
}

/* ============================
   Upcoming payments helper
   ============================ */

function upcomingPayments(buddies: Buddy[], maxItems = 3) {
  const list: { name: string; date: Date }[] = [];
  const now = new Date();
  buddies.forEach((b) => {
    const next = nextPayoutDate(b);
    if (next && next >= now) {
      list.push({ name: b.name, date: next });
    }
  });
  list.sort((a, b) => a.date.getTime() - b.date.getTime());
  return list.slice(0, maxItems);
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
    return parsed.map((p: any) => recomputeBuddy(normalizeBuddy(p)));
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
    Alert.alert("Save failed", "Could not persist your buddies.");
  }
}

/* ============================
   Main component
   ============================ */

export default function BuddyStocksScreen() {
  const router = useRouter();
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const loaded = await loadBuddies();
      setBuddies(loaded);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(
    async (next: Buddy[]) => {
      setBuddies(next);
      await saveBuddies(next);
    },
    [setBuddies]
  );

  const addOrUpdateBuddy = useCallback(
    async (incoming: Partial<Buddy>) => {
      const normalized = normalizeBuddy(incoming);
      const recomputed = recomputeBuddy(normalized);
      const next = [...buddies.filter((s) => s.id !== recomputed.id), recomputed];
      await persist(next);
    },
    [buddies, persist]
  );

  const removeBuddy = useCallback(
    async (id: string) => {
      const next = buddies.filter((b) => b.id !== id);
      await persist(next);
    },
    [buddies, persist]
  );

  const updateBuddy = useCallback(
    async (updated: Buddy) => {
      const next = buddies.map((b) => (b.id === updated.id ? recomputeBuddy(updated) : b));
      await persist(next);
    },
    [buddies, persist]
  );

  /* Add / Edit modal state */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<any>({
    id: "",
    name: "",
    buddyId: "",
    investmentType: "stock",
    startDate: "",
    daysPerPayout: "",
    totalInvestedStr: "",
    payoutValueStr: "",
    buddyPayoutStr: "",
    itemName: "",
    totalPayoutsStr: "",
  });

  const openAdd = () => {
    setForm({
      id: uid("b"),
      name: "",
      buddyId: "",
      investmentType: "stock",
      startDate: "",
      daysPerPayout: "",
      totalInvestedStr: "",
      payoutValueStr: "",
      buddyPayoutStr: "",
      itemName: "",
      totalPayoutsStr: "",
    });
    setModalOpen(true);
  };

  const openEdit = (b: Buddy) => {
    setForm({
      id: b.id,
      name: b.name,
      buddyId: b.buddyId,
      investmentType: b.investmentType,
      startDate: b.startDate ?? "",
      daysPerPayout: String(b.daysPerPayout ?? ""),
      totalInvestedStr: b.totalInvested ? String(Math.round(b.totalInvested / 100)) : "",
      payoutValueStr: b.payoutValue ? String(Math.round(b.payoutValue / 100)) : "",
      buddyPayoutStr: b.buddyPayout ? String(Math.round(b.buddyPayout / 100)) : "",
      itemName: b.itemName ?? "",
      totalPayoutsStr: String(b.totalPayouts ?? ""),
    });
    setModalOpen(true);
  };

  const saveEditing = async () => {
    if (!form.name?.trim()) {
      Alert.alert("Validation", "Buddy name is required.");
      return;
    }
    const totalInvestedCents = parseCurrencyInput(form.totalInvestedStr);
    const payoutValueCents = parseCurrencyInput(form.payoutValueStr);
    const buddyPayoutCents = parseCurrencyInput(form.buddyPayoutStr);
    const daysPerPayout = toInt(form.daysPerPayout, 0);
    const totalPayouts = toInt(form.totalPayoutsStr, 0);

    const toSave: Partial<Buddy> = {
      id: form.id,
      name: form.name.trim(),
      buddyId: form.buddyId.trim(),
      investmentType: form.investmentType,
      startDate: form.startDate || null,
      daysPerPayout,
      totalInvested: totalInvestedCents,
      payoutValue: payoutValueCents,
      buddyPayout: buddyPayoutCents,
      itemName: form.itemName || null,
      totalPayouts,
    };

    await addOrUpdateBuddy(toSave);
    setModalOpen(false);
  };

  /* Portfolio overview derived values */
  const overview = useMemo(() => {
    const totals = buddies.reduce(
      (acc, b) => {
        const r = computeBuddyROI(b);
        acc.invested += r.invested;
        acc.received += r.received;
        return acc;
      },
      { invested: 0, received: 0 }
    );
    const payoutsWeek = buddies.reduce((s, b) => {
      const bb = recomputeBuddy(b);
      if (bb.daysPerPayout > 0 && bb.payoutValue > 0) {
        const weekly = (bb.payoutValue * 7) / bb.daysPerPayout;
        return s + Math.round(weekly);
      }
      return s;
    }, 0);
    const avgROI = buddies.length === 0 ? 0 : buddies.reduce((s, b) => s + computeBuddyROI(b).roi, 0) / Math.max(1, buddies.length);
    const nextEntry = buddies
      .map((b) => ({ b, next: nextPayoutDate(b) }))
      .filter((x) => x.next)
      .sort((a, b) => (a.next!.getTime() - b.next!.getTime()))[0];
    const nextDate = nextEntry ? nextEntry.next : null;
    return { ...totals, payoutsWeek, avgROI, nextDate };
  }, [buddies]);

  const upcoming = useMemo(() => upcomingPayments(buddies, 5), [buddies]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: THEME.background }]}>
        <Text style={{ color: THEME.text }}>Loading buddies…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
      <FlatList
        data={buddies.sort((a, b) => a.name.localeCompare(b.name))}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={styles.title}>Buddy Stocks</Text>

              <View style={styles.overviewRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Total invested</Text>
                  <Text style={styles.statValue}>{formatCurrencyNoDecimals(overview.invested)}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Total received</Text>
                  <Text style={styles.statValue}>{formatCurrencyNoDecimals(overview.received)}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Payouts / week</Text>
                  <Text style={styles.statValue}>{formatCurrencyNoDecimals(overview.payoutsWeek)}</Text>
                </View>
              </View>

              <View style={styles.overviewRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Avg ROI</Text>
                  <Text style={styles.statValue}>{(overview.avgROI * 100).toFixed(1)}%</Text>
                </View>

                <View style={[styles.statCard, { flex: 2 }]}>
                  <Text style={styles.statLabel}>Next payment(s)</Text>
                  {upcoming.length === 0 ? (
                    <Text style={[styles.statValue, { fontSize: 14 }]}>None</Text>
                  ) : (
                    upcoming.map((u, i) => (
                      <Text key={i} style={{ color: THEME.text, fontWeight: "700", marginTop: i === 0 ? 6 : 4 }}>
                        {u.name} • {u.date.toLocaleDateString()}
                      </Text>
                    ))
                  )}
                </View>
              </View>

              <View style={{ padding: 12 }}>
                <Pressable style={[styles.addButton, { backgroundColor: THEME.accent }]} onPress={openAdd}>
                  <Text style={styles.addButtonText}>Add Investment</Text>
                </Pressable>
              </View>
            </View>
          </>
        }
        renderItem={({ item }) => {
          const r = computeBuddyROI(item);
          const next = nextPayoutDate(item);
          const daysToBreak = daysUntilBreakEven(item);
          const buddyPayoutLabel = `${item.name} payout`;
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardSub}>{item.investmentType.toUpperCase()}</Text>
              </View>

              <View style={styles.cardBody}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.field}>
                    <Text style={styles.fieldLabel}>Buddy ID</Text> {item.buddyId || "—"}
                  </Text>
                  <Text style={styles.field}>
                    <Text style={styles.fieldLabel}>Start date</Text> {item.startDate || "—"}
                  </Text>
                  <Text style={styles.field}>
                    <Text style={styles.fieldLabel}>Days per payout</Text> {item.daysPerPayout || "—"}
                  </Text>
                  <Text style={styles.field}>
                    <Text style={styles.fieldLabel}>Item name</Text> {item.itemName || "—"}
                  </Text>
                </View>

                {/* Neat info box on the right */}
                <View style={styles.infoBox}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Invested</Text>
                    <Text style={styles.infoValue}>{formatCurrencyNoDecimals(item.totalInvested)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Payout</Text>
                    <Text style={styles.infoValue}>{formatCurrencyNoDecimals(item.payoutValue)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{buddyPayoutLabel}</Text>
                    <Text style={styles.infoValue}>{formatCurrencyNoDecimals(item.buddyPayout)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Next payout</Text>
                    <Text style={styles.infoValue}>{next ? next.toLocaleDateString() : "—"}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <View>
                  <Text style={styles.roiLabel}>ROI</Text>
                  <Text style={styles.roiValue}>{(r.roi * 100).toFixed(1)}%</Text>
                </View>
                <View style={{ marginLeft: 16 }}>
                  <Text style={styles.roiLabel}>Days to break even</Text>
                  <Text style={styles.roiValue}>{daysToBreak === null ? "N/A" : `${daysToBreak} days`}</Text>
                </View>

                <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center" }}>
                  <Pressable style={styles.smallBtn} onPress={() => openEdit(item)}>
                    <Text style={styles.smallBtnText}>Edit</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.smallBtn, { marginLeft: 8, backgroundColor: THEME.accent }]}
                    onPress={() => {
                      // Navigate to path param route: /payment-schedule/[buddyId]
                      router.push(`/payment-schedule/${encodeURIComponent(item.id)}`);
                    }}
                  >
                    <Text style={[styles.smallBtnText, { color: "#fff" }]}>Schedule</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.smallBtn, { marginLeft: 8, backgroundColor: THEME.danger }]}
                    onPress={() =>
                      Alert.alert("Remove", "Remove this buddy?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: async () => await removeBuddy(item.id) },
                      ])
                    }
                  >
                    <Text style={styles.smallBtnText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={{ padding: 12, color: THEME.muted }}>No investments yet</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      {/* Add / Edit Modal */}
      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[styles.modal, { backgroundColor: THEME.surface }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.modalHeader, { color: THEME.text }]}>{form.id ? "Edit Investment" : "Add Investment"}</Text>

            <Text style={styles.label}>Buddy name</Text>
            <TextInput value={form.name} onChangeText={(t) => setForm((s: any) => ({ ...s, name: t }))} style={styles.input} placeholder="Them" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Buddy ID</Text>
            <TextInput value={form.buddyId} onChangeText={(t) => setForm((s: any) => ({ ...s, buddyId: t }))} style={styles.input} placeholder="Optional" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Payment type</Text>
            <View style={{ flexDirection: "row", marginBottom: 8 }}>
              <Pressable style={[styles.typeBtn, form.investmentType === "stock" ? styles.typeBtnActive : null]} onPress={() => setForm((s: any) => ({ ...s, investmentType: "stock" }))}>
                <Text style={form.investmentType === "stock" ? styles.typeBtnTextActive : styles.typeBtnText}>Stock</Text>
              </Pressable>
              <Pressable style={[styles.typeBtn, form.investmentType === "bank" ? styles.typeBtnActive : null, { marginLeft: 8 }]} onPress={() => setForm((s: any) => ({ ...s, investmentType: "bank" }))}>
                <Text style={form.investmentType === "bank" ? styles.typeBtnTextActive : styles.typeBtnText}>Bank</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Start date</Text>
            <TextInput value={form.startDate} onChangeText={(t) => setForm((s: any) => ({ ...s, startDate: t }))} style={styles.input} placeholder="DD-MM-YYYY" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Days per payout</Text>
            <TextInput value={form.daysPerPayout} onChangeText={(t) => setForm((s: any) => ({ ...s, daysPerPayout: t }))} style={styles.input} keyboardType="numeric" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Total invested</Text>
            <TextInput value={form.totalInvestedStr} onChangeText={(t) => setForm((s: any) => ({ ...s, totalInvestedStr: t }))} style={styles.input} placeholder="e.g., 12.34 or 1M or 100k" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Payout value (to you)</Text>
            <TextInput value={form.payoutValueStr} onChangeText={(t) => setForm((s: any) => ({ ...s, payoutValueStr: t }))} style={styles.input} placeholder="e.g., 1.23 or 1k" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Buddy payout (to them)</Text>
            <TextInput value={form.buddyPayoutStr} onChangeText={(t) => setForm((s: any) => ({ ...s, buddyPayoutStr: t }))} style={styles.input} placeholder="Optional (e.g., 1k, 1M)" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Item name</Text>
            <TextInput value={form.itemName} onChangeText={(t) => setForm((s: any) => ({ ...s, itemName: t }))} style={styles.input} placeholder="Optional" placeholderTextColor={THEME.muted} />

            <Text style={styles.label}>Total payouts</Text>
            <TextInput value={form.totalPayoutsStr} onChangeText={(t) => setForm((s: any) => ({ ...s, totalPayoutsStr: t }))} style={styles.input} keyboardType="numeric" placeholderTextColor={THEME.muted} />

            <View style={{ height: 12 }} />
            <View style={styles.modalButtons}>
              <Button title="Cancel" onPress={() => setModalOpen(false)} color={THEME.danger} />
              <Button title="Save" onPress={saveEditing} color={THEME.accent} />
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
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
  title: { color: THEME.text, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  overviewRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  statCard: { flex: 1, backgroundColor: THEME.card, padding: 10, marginRight: 8, borderRadius: 8 },
  statLabel: { color: THEME.muted, fontSize: 12 },
  statValue: { color: THEME.text, fontWeight: "700", marginTop: 6 },
  addButton: { padding: 12, borderRadius: 8, alignItems: "center" },
  addButtonText: { color: "#fff", fontWeight: "700" },
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
  cardFooter: { flexDirection: "row", alignItems: "center" },
  roiLabel: { color: THEME.muted, fontSize: 12 },
  roiValue: { color: THEME.text, fontWeight: "700" },
  smallBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#122033", borderRadius: 6 },
  smallBtnText: { color: THEME.text, fontSize: 12 },
  modal: { padding: 16, paddingBottom: 40 },
  modalHeader: { fontSize: 18, fontWeight: "700", marginBottom: 12, color: THEME.text },
  input: { borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 8, borderColor: THEME.inputBorder, backgroundColor: THEME.inputBg, color: THEME.text },
  label: { color: THEME.muted, marginBottom: 6, fontWeight: "700" },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  typeBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: "#122033" },
  typeBtnActive: { backgroundColor: THEME.accent },
  typeBtnText: { color: THEME.text },
  typeBtnTextActive: { color: "#fff" },
});
