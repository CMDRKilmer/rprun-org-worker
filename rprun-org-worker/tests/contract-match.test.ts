// tests/contract-match.test.ts
// utils/contract-match 单测：覆盖正常匹配、价格容差、items 集合等、
// template 反转规则、缺字段等。设计文档：AUTO_LINK_CONTRACT.md
// 任何规则变更必须同步前端 RUNCN/src/infrastructure/org-api/contract-link.ts。

import { describe, it, expect } from 'vitest';
import {
  matchContractFingerprint,
  effectiveTemplate,
  type ContractFingerprint,
} from '../src/utils/contract-match';
import type { TaskContractJson } from '../src/types';

function baseTaskJson(): TaskContractJson {
  return {
    template: 'BUY',
    currency: 'AIC',
    location: 'Antares',
    items: [{ commodity: 'RAT', amount: 100, price: 50 }],
  };
}

function baseFingerprint(): ContractFingerprint {
  return {
    template: 'SELL',
    currency: 'AIC',
    location: 'Antares',
    items: [{ commodity: 'RAT', amount: 100, price: 50 }],
  };
}

describe('effectiveTemplate', () => {
  it('SHIP is never inverted', () => {
    expect(effectiveTemplate('SHIP', undefined)).toBe('SHIP');
    expect(effectiveTemplate('SHIP', 'claimer')).toBe('SHIP');
    expect(effectiveTemplate('SHIP', 'publisher')).toBe('SHIP');
  });

  it('BUY + publisher → BUY', () => {
    expect(effectiveTemplate('BUY', 'publisher')).toBe('BUY');
  });

  it('BUY + claimer → SELL (inverted)', () => {
    expect(effectiveTemplate('BUY', 'claimer')).toBe('SELL');
  });

  it('SELL + publisher → SELL', () => {
    expect(effectiveTemplate('SELL', 'publisher')).toBe('SELL');
  });

  it('SELL + claimer → BUY (inverted)', () => {
    expect(effectiveTemplate('SELL', 'claimer')).toBe('BUY');
  });

  it('BUY + undefined creator → fallback SELL (invert branch)', () => {
    // 与前端 auto-link.ts 行为对齐：creator 缺失走反转向。
    expect(effectiveTemplate('BUY', undefined)).toBe('SELL');
  });
});

describe('matchContractFingerprint', () => {
  it('matched when BUY task + claimer + SELL fingerprint with same items', () => {
    const result = matchContractFingerprint(
      baseTaskJson(),
      'claimer',
      baseFingerprint(),
    );
    expect(result.matched).toBe(true);
  });

  it('matched when BUY task + publisher + BUY fingerprint', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      template: 'BUY',
    };
    const result = matchContractFingerprint(baseTaskJson(), 'publisher', fp);
    expect(result.matched).toBe(true);
  });

  it('rejected when template mismatch after invert', () => {
    // BUY + claimer 应期待 fingerprint template=SELL；传 BUY → 不匹配
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      template: 'BUY',
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/template mismatch/);
  });

  it('rejected when currency differs', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      currency: 'NCC',
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/currency mismatch/);
  });

  it('rejected when items amount differs', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      items: [{ commodity: 'RAT', amount: 99, price: 50 }],
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('items mismatch');
  });

  it('rejected when items commodity differs', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      items: [{ commodity: 'H2O', amount: 100, price: 50 }],
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('items mismatch');
  });

  it('matched when items price within ±0.5% tolerance', () => {
    // 50 ± 0.5% = 49.75 ~ 50.25
    for (const price of [49.75, 49.99, 50.0, 50.01, 50.25]) {
      const fp: ContractFingerprint = {
        ...baseFingerprint(),
        items: [{ commodity: 'RAT', amount: 100, price }],
      };
      const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
      expect(result.matched, `price=${price}`).toBe(true);
    }
  });

  it('rejected when items price outside tolerance', () => {
    // ±0.5% 容差外
    for (const price of [49.7, 50.3, 100, 0]) {
      const fp: ContractFingerprint = {
        ...baseFingerprint(),
        items: [{ commodity: 'RAT', amount: 100, price }],
      };
      const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
      expect(result.matched, `price=${price}`).toBe(false);
    }
  });

  it('matched when both prices missing (undefined === undefined)', () => {
    const json: TaskContractJson = {
      ...baseTaskJson(),
      items: [{ commodity: 'RAT', amount: 100 }],
    };
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      items: [{ commodity: 'RAT', amount: 100 }],
    };
    const result = matchContractFingerprint(json, 'claimer', fp);
    expect(result.matched).toBe(true);
  });

  it('rejected when one side missing price', () => {
    const json: TaskContractJson = baseTaskJson(); // price=50 on item
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      items: [{ commodity: 'RAT', amount: 100 }], // no price
    };
    const result = matchContractFingerprint(json, 'claimer', fp);
    expect(result.matched).toBe(false);
  });

  it('rejected when location differs', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      location: 'Benten',
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/location mismatch/);
  });

  it('matched when both locations missing', () => {
    const json: TaskContractJson = {
      ...baseTaskJson(),
      location: undefined,
    };
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      location: undefined,
    };
    const result = matchContractFingerprint(json, 'claimer', fp);
    expect(result.matched).toBe(true);
  });

  it('rejected when item count differs', () => {
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      items: [
        { commodity: 'RAT', amount: 100, price: 50 },
        { commodity: 'RAT', amount: 100, price: 50 },
      ],
    };
    const result = matchContractFingerprint(baseTaskJson(), 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('items mismatch');
  });

  it('matched for SHIP template (never inverted) with origin+destination', () => {
    const json: TaskContractJson = {
      template: 'SHIP',
      currency: 'AIC',
      origin: 'Moria',
      destination: 'Benten',
      items: [{ commodity: 'RAT', amount: 50 }],
    };
    const fp: ContractFingerprint = {
      template: 'SHIP',
      currency: 'AIC',
      origin: 'Moria',
      destination: 'Benten',
      items: [{ commodity: 'RAT', amount: 50 }],
    };
    // SHIP 不论 creator 都要求 template=SHIP（已测过）；这里 creator=claimer
    // 因为任务类型 SHIP 在 claimTask 时也是 publisher 作为 creator，
    // 但 fingerprint 反转规则不应作用于 SHIP。
    const result = matchContractFingerprint(json, 'claimer', fp);
    expect(result.matched).toBe(true);
  });

  it('rejected when top-level price differs within tolerance boundary', () => {
    const json: TaskContractJson = {
      ...baseTaskJson(),
      price: 5000,
    };
    const fp: ContractFingerprint = {
      ...baseFingerprint(),
      price: 6000, // 20% 差异
    };
    const result = matchContractFingerprint(json, 'claimer', fp);
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/price mismatch/);
  });
});
