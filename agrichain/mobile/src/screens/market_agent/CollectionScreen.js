import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';

import { getMyOrders, recordCollection, getCollections } from '../../api/marketAgent';
import { C, S } from '../../theme';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-RW', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getLossColor(pct) {
  if (pct === null || isNaN(pct)) return C.gray500;
  if (pct <= 2) return C.success;
  if (pct <= 8) return C.warning;
  return C.danger;
}

function CollectionHistoryCard({ item }) {
  const loss = item.self_transport_loss_pct != null ? parseFloat(item.self_transport_loss_pct) : null;
  const lossColor = getLossColor(loss);

  return (
    <View style={styles.historyCard}>
      <View style={S.spaceBetween}>
        <Text style={styles.historyProduce}>
          {item.crop_name || 'Collection'}
        </Text>
        {loss !== null && (
          <View style={[S.badge, { backgroundColor: lossColor + '1A' }]}>
            <Text style={[S.badgeText, { color: lossColor }]}>{loss.toFixed(1)}% loss</Text>
          </View>
        )}
      </View>
      <Text style={styles.historyDate}>{formatDate(item.collected_at)}</Text>
      <View style={styles.historyDetails}>
        <View style={styles.historyDetail}>
          <Text style={styles.historyDetailLabel}>Collected</Text>
          <Text style={styles.historyDetailValue}>{item.quantity_collected_kg ?? '—'} kg</Text>
        </View>
        <View style={styles.historyDetail}>
          <Text style={styles.historyDetailLabel}>Arrived</Text>
          <Text style={styles.historyDetailValue}>{item.quantity_arrived_at_stall_kg ?? '—'} kg</Text>
        </View>
      </View>
    </View>
  );
}

export default function CollectionScreen() {
  const [orders, setOrders] = useState([]);
  const [collections, setCollections] = useState([]);

  // Form state — an order must be selected: the backend records a collection against a
  // specific Order (created once a distributor confirms the agent's request), not a
  // CollectionNotice directly.
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNoticePicker, setShowNoticePicker] = useState(false);
  const [quantityCollected, setQuantityCollected] = useState('');
  const [quantityArrived, setQuantityArrived] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Derived loss %
  const lossPercent = (() => {
    const col = parseFloat(quantityCollected);
    const arr = parseFloat(quantityArrived);
    if (!isNaN(col) && !isNaN(arr) && col > 0) {
      return Math.max(0, ((col - arr) / col) * 100);
    }
    return null;
  })();

  const lossColor = getLossColor(lossPercent);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [ordersRes, collectionsRes] = await Promise.allSettled([
        getMyOrders(),
        getCollections(),
      ]);

      if (ordersRes.status === 'fulfilled') {
        // OrderViewSet has no query-param filtering, so filter to confirmed-but-not-yet-
        // collected orders client-side.
        const all = ordersRes.value.data?.results || ordersRes.value.data || [];
        setOrders(all.filter((o) => o.status === 'CONFIRMED'));
      }
      if (collectionsRes.status === 'fulfilled') {
        setCollections(collectionsRes.value.data?.results || collectionsRes.value.data || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const resetForm = () => {
    setSelectedOrder(null);
    setQuantityCollected('');
    setQuantityArrived('');
  };

  const handleSubmit = async () => {
    if (!selectedOrder) {
      Alert.alert('Missing Order', 'Select which confirmed order you collected.');
      return;
    }
    if (!quantityCollected || !quantityArrived) {
      Alert.alert('Missing Fields', 'Please enter both collected and arrived quantities.');
      return;
    }
    const col = parseFloat(quantityCollected);
    const arr = parseFloat(quantityArrived);
    if (isNaN(col) || isNaN(arr) || col <= 0 || arr < 0) {
      Alert.alert('Invalid Input', 'Please enter valid quantities.');
      return;
    }
    if (arr > col) {
      Alert.alert('Invalid Input', 'Quantity arrived cannot exceed quantity collected.');
      return;
    }

    setSubmitting(true);
    try {
      await recordCollection({
        order: selectedOrder.id,
        quantity_collected_kg: col,
        quantity_arrived_at_stall_kg: arr,
        collected_at: new Date().toISOString(),
      });
      Alert.alert('Success', 'Collection recorded successfully!');
      resetForm();
      fetchData(true);
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        Object.values(err?.response?.data || {}).flat()?.[0] ||
        'Could not record collection.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={S.screenBg}>
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>Collections</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.screenBg}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchData(true);
              }}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.screenHeader}>
            <Text style={styles.screenTitle}>Collections</Text>
          </View>

          {/* Form Card */}
          <View style={S.card}>
            <Text style={styles.formTitle}>Record New Collection</Text>

            {/* Order picker — collections are recorded against a confirmed order */}
            <View style={styles.fieldGroup}>
              <Text style={S.label}>Confirmed Order</Text>
              <TouchableOpacity
                style={styles.picker}
                onPress={() => setShowNoticePicker((v) => !v)}
              >
                <Ionicons name="document-text-outline" size={16} color={C.gray500} />
                <Text style={[styles.pickerText, !selectedOrder && { color: C.gray400 }]}>
                  {selectedOrder
                    ? `${selectedOrder.crop_name} — ${selectedOrder.distributor_name || ''}`
                    : orders.length === 0
                    ? 'No confirmed orders awaiting collection'
                    : 'Select the order you collected'}
                </Text>
                <Ionicons
                  name={showNoticePicker ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={C.gray400}
                />
              </TouchableOpacity>
              {showNoticePicker && orders.length > 0 && (
                <View style={styles.pickerDropdown}>
                  {orders.map((o) => (
                    <TouchableOpacity
                      key={o.id}
                      style={[
                        styles.pickerOption,
                        selectedOrder?.id === o.id && styles.pickerOptionSelected,
                      ]}
                      onPress={() => {
                        setSelectedOrder(o);
                        setShowNoticePicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          selectedOrder?.id === o.id && { color: C.primary, fontWeight: '600' },
                        ]}
                      >
                        {o.crop_name} — {o.distributor_name || ''} ({Number(o.confirmed_quantity_kg ?? o.quantity_requested_kg).toLocaleString()} kg)
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Quantity collected */}
            <View style={styles.fieldGroup}>
              <Text style={S.label}>Quantity Collected (kg)</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. 500"
                placeholderTextColor={C.gray400}
                value={quantityCollected}
                onChangeText={setQuantityCollected}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Quantity arrived */}
            <View style={styles.fieldGroup}>
              <Text style={S.label}>Quantity Arrived (kg)</Text>
              <TextInput
                style={S.input}
                placeholder="e.g. 480"
                placeholderTextColor={C.gray400}
                value={quantityArrived}
                onChangeText={setQuantityArrived}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Loss preview */}
            {lossPercent !== null && (
              <View style={[styles.lossPreview, { backgroundColor: lossColor + '1A', borderColor: lossColor + '40' }]}>
                <Ionicons name="analytics-outline" size={16} color={lossColor} />
                <Text style={[styles.lossPreviewText, { color: lossColor }]}>
                  Loss:{' '}
                  <Text style={{ fontWeight: '800' }}>{lossPercent.toFixed(1)}%</Text>
                  {' '}({(parseFloat(quantityCollected) - parseFloat(quantityArrived)).toFixed(1)} kg)
                </Text>
              </View>
            )}

            {/* Transport advisory — shown when self-transport loss is high */}
            {lossPercent !== null && lossPercent > 5 && (
              <View style={[
                styles.advisory,
                lossPercent > 10 ? styles.advisoryCritical : styles.advisoryWarning,
              ]}>
                <View style={styles.advisoryHeader}>
                  <Ionicons
                    name="car-outline"
                    size={18}
                    color={lossPercent > 10 ? '#dc2626' : '#d97706'}
                  />
                  <Text style={[
                    styles.advisoryTitle,
                    { color: lossPercent > 10 ? '#dc2626' : '#b45309' },
                  ]}>
                    {lossPercent > 10
                      ? 'High Loss — Distributor Transport Recommended'
                      : 'Consider Distributor Transport'}
                  </Text>
                </View>
                <Text style={[
                  styles.advisoryBody,
                  { color: lossPercent > 10 ? '#991b1b' : '#92400e' },
                ]}>
                  {lossPercent > 10
                    ? `A ${lossPercent.toFixed(1)}% loss in self-transport is critically high. Request distributor-arranged delivery on your next order to significantly reduce transit losses.`
                    : `Your self-transport loss of ${lossPercent.toFixed(1)}% exceeds the 5% target. Distributor transport typically reduces transit losses by up to 60% on routes over 10 km.`}
                </Text>
                <View style={styles.advisoryTip}>
                  <Ionicons name="information-circle-outline" size={13} color={lossPercent > 10 ? '#dc2626' : '#d97706'} />
                  <Text style={[styles.advisoryTipText, { color: lossPercent > 10 ? '#991b1b' : '#92400e' }]}>
                    When placing your next order, select <Text style={{ fontWeight: '700' }}>Distributor Delivery</Text> as the delivery method.
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[S.button, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color={C.white} />
              ) : (
                <>
                  <Ionicons name="add-circle-outline" size={18} color={C.white} />
                  <Text style={[S.buttonText, { marginLeft: 8 }]}>Record Collection</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Recent collections */}
          <Text style={S.sectionTitle}>Recent Collections</Text>
          {collections.length === 0 ? (
            <View style={[S.card, S.emptyContainer, { paddingVertical: 32 }]}>
              <Ionicons name="basket-outline" size={40} color={C.gray200} />
              <Text style={S.emptyText}>No collections yet</Text>
            </View>
          ) : (
            collections.map((c) => (
              <CollectionHistoryCard key={c.id} item={c} />
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    paddingBottom: 8,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: C.gray900,
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.gray900,
    marginBottom: 16,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.gray50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.gray200,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerText: {
    flex: 1,
    fontSize: 15,
    color: C.gray900,
  },
  pickerDropdown: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.gray200,
    marginTop: 4,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 4 },
    }),
  },
  pickerOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
  },
  pickerOptionSelected: {
    backgroundColor: C.primaryLight,
  },
  pickerOptionText: {
    fontSize: 14,
    color: C.gray700,
  },
  lossPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  lossPreviewText: {
    fontSize: 14,
  },
  advisory: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  advisoryWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  advisoryCritical: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  advisoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  advisoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  advisoryBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  advisoryTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 8,
    padding: 8,
  },
  advisoryTipText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  historyCard: {
    backgroundColor: C.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
      android: { elevation: 2 },
    }),
  },
  historyProduce: {
    fontSize: 14,
    fontWeight: '700',
    color: C.gray900,
  },
  historyDate: {
    fontSize: 12,
    color: C.gray500,
    marginTop: 2,
    marginBottom: 10,
  },
  historyDetails: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  historyDetail: {},
  historyDetailLabel: {
    fontSize: 11,
    color: C.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  historyDetailValue: {
    fontSize: 13,
    color: C.gray700,
    fontWeight: '600',
    marginTop: 1,
  },
});
