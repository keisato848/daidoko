/**
 * Visual countdown timer with circular progress and controls
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { useTimerStore } from '../stores/timer.store';

interface TimerWidgetProps {
  timerSec: number;
  onFinish?: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimerWidget({ timerSec, onFinish }: TimerWidgetProps) {
  const { totalSec, remainingSec, status, setup, start, pause, resume, reset } = useTimerStore();

  // Set up timer when timerSec changes
  useEffect(() => {
    setup(timerSec);
    return () => {
      useTimerStore.getState().clear();
    };
  }, [timerSec, setup]);

  // Notify on finish
  useEffect(() => {
    if (status === 'finished') {
      onFinish?.();
    }
  }, [status, onFinish]);

  const progress = totalSec > 0 ? (totalSec - remainingSec) / totalSec : 0;

  const handleMainAction = () => {
    if (status === 'idle') start();
    else if (status === 'running') pause();
    else if (status === 'paused') resume();
    else if (status === 'finished') reset();
  };

  const getActionLabel = (): string => {
    if (status === 'idle') return '開始';
    if (status === 'running') return '一時停止';
    if (status === 'paused') return '再開';
    return 'リセット';
  };

  return (
    <View style={styles.container}>
      {/* Progress ring (simplified as a bar) */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>

      {/* Time display */}
      <Text style={[styles.time, status === 'finished' && styles.timeFinished]}>
        {status === 'finished' ? '完了！' : formatTime(remainingSec)}
      </Text>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={[
            styles.mainButton,
            status === 'running' && styles.pauseButton,
            status === 'finished' && styles.finishedButton,
          ]}
          onPress={handleMainAction}
        >
          <Text
            style={[
              styles.mainButtonText,
              status === 'running' && styles.pauseButtonText,
              status === 'finished' && styles.finishedButtonText,
            ]}
          >
            {getActionLabel()}
          </Text>
        </Pressable>
        {(status === 'running' || status === 'paused') && (
          <Pressable style={styles.resetButton} onPress={reset}>
            <Text style={styles.resetButtonText}>リセット</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  progressContainer: {
    width: '80%',
  },
  progressBg: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: 2,
  },
  time: {
    fontSize: 36, // timer: タイマー数値
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: Colors.gold,
    letterSpacing: 2,
  },
  timeFinished: {
    color: '#7FFFAA',
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
  },
  mainButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: Colors.gold,
    borderRadius: 8,
  },
  pauseButton: {
    backgroundColor: '#1A1108',
    borderWidth: 1,
    borderColor: Colors.gold,
  },
  finishedButton: {
    backgroundColor: '#2A6040',
    borderWidth: 1,
    borderColor: '#3D8A5A',
  },
  mainButtonText: {
    fontSize: 15, // base: タイマーCTAボタン
    fontWeight: '600',
    color: Colors.bg,
  },
  pauseButtonText: {
    color: Colors.gold,
  },
  finishedButtonText: {
    color: '#7FFFAA',
  },
  resetButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resetButtonText: {
    fontSize: 15, // base: リセットボタン
    fontWeight: '400',
    color: Colors.paperDim,
  },
});
