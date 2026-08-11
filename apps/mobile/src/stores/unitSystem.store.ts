/**
 * 単位系の設定（P1・`docs/多言語対応設計.md` §4）。
 *
 * 表示のたびに読むので、描画から同期的に引ける必要がある（DB を待てない）。
 * 起動時に一度 `loadUnitSystem()` で app_meta から読み、以後はここが持つ。
 *
 * 言語とは別の設定にしている。**英国の利用者は英語だがメートル法**で、
 * 言語から単位を決めると必ず外す。既定だけ端末の地域から決める。
 */
import { create } from 'zustand';

import { getAppMeta, setAppMeta } from '../services/app-meta.service';
import { DEFAULT_UNIT_SYSTEM, unitSystemForRegion, type UnitSystem } from '../utils/unitSystem';

const UNIT_SYSTEM_KEY = 'unit_system';

interface UnitSystemState {
  system: UnitSystem;
  /** app_meta から読み終えたか。未読込のうちは既定値を返している */
  loaded: boolean;
  setSystem: (next: UnitSystem) => Promise<void>;
  /** テスト用: 保存せずに差し替える */
  setSystemForTesting: (next: UnitSystem) => void;
}

export const useUnitSystemStore = create<UnitSystemState>((set) => ({
  system: DEFAULT_UNIT_SYSTEM,
  loaded: false,
  setSystem: async (next) => {
    set({ system: next });
    await setAppMeta(UNIT_SYSTEM_KEY, next).catch(() => undefined);
  },
  setSystemForTesting: (next) => set({ system: next }),
}));

/** 描画の外から読む用（純関数のユーティリティへ渡すとき）。 */
export function getUnitSystem(): UnitSystem {
  return useUnitSystemStore.getState().system;
}

function parseUnitSystem(value: string | null): UnitSystem | null {
  return value === 'metric' || value === 'imperial' ? value : null;
}

/**
 * 起動時に一度呼ぶ。保存済みの選択があればそれを、無ければ端末の地域から決める。
 * **既定を保存はしない** — 端末を持ち替えたら、その地域の既定に従ってほしいため。
 */
export async function loadUnitSystem(region: string | null | undefined): Promise<UnitSystem> {
  const stored = parseUnitSystem(await getAppMeta(UNIT_SYSTEM_KEY).catch(() => null));
  const system = stored ?? unitSystemForRegion(region);
  useUnitSystemStore.setState({ system, loaded: true });
  return system;
}
