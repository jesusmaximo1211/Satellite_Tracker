/**
 * Modo Brújula / Orientación Asistida (RF-07 y Sección 4.5):
 * - Utiliza Magnetómetro y Acelerómetro (o controles manuales en emulador/web) para guiar al usuario
 *   hacia el Azimut y Elevación exactos del satélite seleccionado.
 * - Muestra diferencial angular (ΔAzimut y ΔElevación) e indicador de bloqueo de apuntamiento ( Antenna Lock ).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { DeviceOrientationState, observerService } from '../observer/ObserverService';
import { SatelliteRealtimeState } from '../types/orbital';

export interface CompassOverlayProps {
  satelliteState: SatelliteRealtimeState | null;
}

export const CompassOverlay: React.FC<CompassOverlayProps> = ({ satelliteState }) => {
  const [sensorState, setSensorState] = useState<DeviceOrientationState>({
    headingDeg: 0,
    pitchDeg: 25,
    hasSensorHardware: false,
  });
  const [manualMode, setManualMode] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = observerService.subscribeOrientation((st) => {
      if (!manualMode) {
        setSensorState(st);
      }
    });
    return unsubscribe;
  }, [manualMode]);

  if (!satelliteState) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyText}>Seleccioná un satélite para activar el modo brújula.</Text>
      </View>
    );
  }

  const targetAz = satelliteState.azimuthDeg;
  const targetEl = satelliteState.elevationDeg;

  // Diferencia circular de azimut (-180° a +180°)
  const deltaAz = ((targetAz - sensorState.headingDeg + 540) % 360) - 180;
  const deltaEl = targetEl - sensorState.pitchDeg;
  const isAligned = Math.abs(deltaAz) <= 8 && Math.abs(deltaEl) <= 8;

  // Instrucción asistida de apuntamiento
  let guidanceText = '¡ANTENA / DISPOSITIVO ALINEADO CON EL SATÉLITE!';
  if (!isAligned) {
    const horizInstr =
      Math.abs(deltaAz) <= 8
        ? 'Rumbo OK'
        : deltaAz > 0
        ? `Girá ${Math.abs(deltaAz).toFixed(0)}° a la DERECHA ↻`
        : `Girá ${Math.abs(deltaAz).toFixed(0)}° a la IZQUIERDA ↺`;

    const vertInstr =
      Math.abs(deltaEl) <= 8
        ? 'Inclinación OK'
        : deltaEl > 0
        ? `Subí ${Math.abs(deltaEl).toFixed(0)}° ▲`
        : `Bajá ${Math.abs(deltaEl).toFixed(0)}° ▼`;

    guidanceText = `${horizInstr}  •  ${vertInstr}`;
  }

  // Coordenadas de la mira del objetivo dentro del dial de 240x240
  const dialSize = 240;
  const center = dialSize / 2;
  const radius = 92;
  const relAngleRad = ((deltaAz - 90) * Math.PI) / 180;
  const targetX = center + radius * Math.cos(relAngleRad);
  const targetY = center + radius * Math.sin(relAngleRad);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Modo Brújula y Apuntamiento Asistido (RF-07)</Text>
          <Text style={styles.subtitle}>
            Objetivo: {satelliteState.name} ({satelliteState.orbitRegime})
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.simBtn, manualMode && styles.simBtnActive]}
          onPress={() => setManualMode((m) => !m)}
        >
          <Text style={styles.simBtnText}>
            {manualMode ? 'Sensores Manuales' : 'Sensores Físicos'}
          </Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.guidanceBanner,
          isAligned ? styles.guidanceBannerLocked : styles.guidanceBannerSeeking,
        ]}
      >
        <Text style={[styles.guidanceText, isAligned && styles.guidanceTextLocked]}>
          {guidanceText}
        </Text>
      </View>

      <View style={styles.dialContainer}>
        <Svg width={dialSize} height={dialSize} viewBox={`0 0 ${dialSize} ${dialSize}`}>
          {/* Anillo exterior del dial */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            fill="#07111e"
            stroke={isAligned ? '#22c55e' : '#334155'}
            strokeWidth={3}
          />
          <Circle
            cx={center}
            cy={center}
            r={radius * 0.55}
            fill="none"
            stroke="#1e293b"
            strokeWidth={1}
            strokeDasharray="4,4"
          />

          {/* Cruz central de mira del teléfono */}
          <Line x1={center - 18} y1={center} x2={center + 18} y2={center} stroke="#475569" strokeWidth={1.5} />
          <Line x1={center} y1={center - 18} x2={center} y2={center + 18} stroke="#475569" strokeWidth={1.5} />

          {/* Flecha fija de frente del teléfono (Arriba) */}
          <Polygon
            points={`${center},${center - radius - 10} ${center - 7},${center - radius + 4} ${center + 7},${center - radius + 4}`}
            fill="#38bdf8"
          />

          {/* Vector hacia el satélite relativo al rumbo del dispositivo */}
          <Line
            x1={center}
            y1={center}
            x2={targetX}
            y2={targetY}
            stroke={isAligned ? '#22c55e' : '#f59e0b'}
            strokeWidth={2.5}
          />

          {/* Marcador del satélite en el borde de rumbo */}
          <G>
            <Circle
              cx={targetX}
              cy={targetY}
              r={10}
              fill={isAligned ? '#22c55e' : '#ef4444'}
              stroke="#ffffff"
              strokeWidth={1.8}
            />
            <SvgText
              x={targetX - 10}
              y={targetY + 4}
              fill="#ffffff"
              fontSize="9"
              fontWeight="bold"
            >
              SAT
            </SvgText>
          </G>
        </Svg>
      </View>

      <View style={styles.metricsGrid}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Azimut Satélite</Text>
          <Text style={styles.metricVal}>{targetAz.toFixed(1)}°</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Rumbo Dispositivo</Text>
          <Text style={styles.metricVal}>{sensorState.headingDeg.toFixed(1)}°</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Elevación Satélite</Text>
          <Text style={[styles.metricVal, targetEl < 0 && { color: '#f87171' }]}>
            {targetEl.toFixed(1)}° {targetEl < 0 ? '(Bajo horiz.)' : ''}
          </Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Inclinación Teléfono</Text>
          <Text style={styles.metricVal}>{sensorState.pitchDeg.toFixed(1)}°</Text>
        </View>
      </View>

      {/* Controles de simulación manual para probar en emulador o PC y alinear en 1 clic */}
      <View style={styles.simControlsBox}>
        <Text style={styles.simHelp}>
          Controles de orientación (para prueba en emulador / ajuste fino):
        </Text>
        <View style={styles.simButtonsRow}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => {
              setManualMode(true);
              setSensorState((s) => ({ ...s, headingDeg: (s.headingDeg - 15 + 360) % 360 }));
            }}
          >
            <Text style={styles.stepBtnText}>↺ Rumbo -15°</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => {
              setManualMode(true);
              setSensorState((s) => ({ ...s, headingDeg: (s.headingDeg + 15) % 360 }));
            }}
          >
            <Text style={styles.stepBtnText}>↻ Rumbo +15°</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => {
              setManualMode(true);
              setSensorState((s) => ({ ...s, pitchDeg: Math.max(-20, s.pitchDeg - 10) }));
            }}
          >
            <Text style={styles.stepBtnText}>▼ Pitch -10°</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => {
              setManualMode(true);
              setSensorState((s) => ({ ...s, pitchDeg: Math.min(90, s.pitchDeg + 10) }));
            }}
          >
            <Text style={styles.stepBtnText}>▲ Pitch +10°</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stepBtn, styles.alignNowBtn]}
            onPress={() => {
              setManualMode(true);
              setSensorState({
                headingDeg: targetAz,
                pitchDeg: targetEl,
                hasSensorHardware: true,
              });
            }}
          >
            <Text style={styles.alignNowText}>🎯 Alinear al Satélite</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  simBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  simBtnActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c4a6e',
  },
  simBtnText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '600',
  },
  guidanceBanner: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  guidanceBannerSeeking: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  guidanceBannerLocked: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  guidanceText: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  guidanceTextLocked: {
    color: '#4ade80',
  },
  dialContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metricBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#07111e',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 11,
  },
  metricVal: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  simControlsBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  simHelp: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 8,
  },
  simButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stepBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stepBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  alignNowBtn: {
    backgroundColor: '#0284c7',
  },
  alignNowText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
});

