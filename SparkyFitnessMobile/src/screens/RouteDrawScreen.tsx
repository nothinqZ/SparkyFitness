import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useCSSVariable } from 'uniwind';
import { routeDistanceMeters, type RoutePoint } from '@workspace/shared';
import Button from '../components/ui/Button';
import { usePreferences } from '../hooks/usePreferences';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { addLog } from '../services/LogService';
import { saveDrawnRoute } from '../services/routeService';
import { formatRouteDistance } from '../utils/routeDisplay';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'RouteDraw'>;

/** Shows most of a continent until the person's position is known. */
const FALLBACK_REGION = {
  latitude: 39.8,
  longitude: -98.6,
  latitudeDelta: 40,
  longitudeDelta: 40,
};
const MIN_ROUTE_METERS = 10;
/** Every point is a tap, so this is far more than anyone draws by hand. */
const MAX_DRAWN_POINTS = 500;

/**
 * Draw a route by tapping the map: each tap adds a point and the points are
 * joined by straight lines, so tap often around bends.
 */
const RouteDrawScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { preferences } = usePreferences();
  const unit = preferences?.default_distance_unit ?? 'km';
  const lineColor = useCSSVariable('--color-accent-primary') as string;
  const mapRef = useRef<MapView>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const distance = routeDistanceMeters(points);
  const canSave =
    points.length >= 2 && distance >= MIN_ROUTE_METERS && name.trim() !== '';

  const centerOnPerson = () => {
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;
      const last = await Location.getLastKnownPositionAsync();
      if (!last) return;
      mapRef.current?.animateToRegion(
        {
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        0
      );
    })().catch(() => undefined);
  };

  const save = () => {
    setSaving(true);
    void saveDrawnRoute({ name: name.trim(), points })
      .then((route) => navigation.replace('RouteDetail', { id: route.id }))
      .catch((error: unknown) => {
        addLog(`[Routes] Could not save a drawn route: ${error}`, 'WARNING');
        Toast.show({
          type: 'error',
          text1: t('routes.saveFailed', {
            defaultValue: 'Could not save the route',
          }),
        });
      })
      .finally(() => setSaving(false));
  };

  const header = useScreenHeader({
    title: t('screens.routeDraw', { defaultValue: 'Draw a route' }),
    left: { kind: 'back' },
    right: {
      kind: 'primary',
      onPress: save,
      disabled: !canSave || saving,
      busy: saving,
    },
  });

  const coordinates = points.map((p) => ({
    latitude: p.lat,
    longitude: p.lon,
  }));

  return (
    <>
      {header}
      <View className="flex-1 bg-background">
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={FALLBACK_REGION}
          onMapReady={centerOnPerson}
          onPress={(event) => {
            const { latitude, longitude } = event.nativeEvent.coordinate;
            if (points.length >= MAX_DRAWN_POINTS) {
              Toast.show({
                type: 'info',
                text1: t('routes.drawLimit', {
                  defaultValue:
                    'That is as many points as a route can have here. Undo some or save this one.',
                }),
              });
              return;
            }
            setPoints((current) => [
              ...current,
              { lat: latitude, lon: longitude },
            ]);
          }}
          showsUserLocation
          toolbarEnabled={false}
        >
          {coordinates.length > 1 ? (
            <Polyline
              coordinates={coordinates}
              strokeColor={lineColor}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}
          {/* Only the ends are marked: a marker per tap is a native view each. */}
          {coordinates.map((coordinate, index) =>
            index === 0 || index === coordinates.length - 1 ? (
              <Marker
                key={index}
                coordinate={coordinate}
                pinColor={index === 0 ? 'green' : 'red'}
              />
            ) : null
          )}
        </MapView>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="absolute left-0 right-0 bottom-0 bg-surface"
        >
          {/* The padding lives inside: on iOS the avoiding view sets its own
              paddingBottom and would replace the safe-area one. */}
          <View
            className="px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <TextInput
              className="border-b border-border-subtle text-text-primary py-1"
              style={{ fontSize: 16 }}
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholder={t('routes.namePlaceholder', {
                defaultValue: 'Name this route',
              })}
              accessibilityLabel={t('routes.nameLabel', {
                defaultValue: 'Route name',
              })}
            />
            <View className="flex-row items-center justify-between mt-3">
              <Text className="text-text-primary text-base font-semibold">
                {points.length < 2
                  ? t('routes.drawHint', {
                      defaultValue: 'Tap the map to add points',
                    })
                  : formatRouteDistance(distance, unit)}
              </Text>
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  disabled={points.length === 0}
                  onPress={() => setPoints((current) => current.slice(0, -1))}
                >
                  {t('routes.undo', { defaultValue: 'Undo' })}
                </Button>
                <Button
                  variant="secondary"
                  disabled={points.length === 0}
                  onPress={() => setPoints([])}
                >
                  {t('routes.clear', { defaultValue: 'Clear' })}
                </Button>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </>
  );
};

export default RouteDrawScreen;
