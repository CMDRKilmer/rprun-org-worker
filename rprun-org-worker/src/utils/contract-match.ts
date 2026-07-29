// src/utils/contract-match.ts
// 自动关联合同方案的权威匹配工具（后端）。
// 设计文档：AUTO_LINK_CONTRACT.md §"方案 B（后端权威匹配）"
//
// 前端轮询 PrUn contractsStore，找到候选合同后调用本服务的
// POST /tasks/:id/match-contract 端点二次确认，避免不同客户端
// 指纹规则分叉。
//
// 与前端 RUNCN/src/infrastructure/org-api/contract-link.ts 内
// matchContractJson 等价但独立实现——两端不应 import 对方代码。
// 任何规则变更必须同步两端。

import type {
  TaskContractJson, TaskContractItem, ContractCreator,
} from '../types';

// 前端上报的最小合同摘要（投影片段，对应前端 ContractFingerprint）
export interface ContractFingerprint {
  template: TaskContractJson['template'];
  currency: string;
  items: Array<{ commodity: string; amount: number; price?: number }>;
  location?: string;
  origin?: string;
  destination?: string;
  price?: number;
  // 交易对方 PrUn username（去掉公司后缀的纯 username 部分）。
  // 必填：避免不同玩家签相同 fingerprint 误匹配。
  partnerName?: string;
  // 交易对方公司代码（PrUn partner.code，如 "QPL"）。
  // 与 partnerName 互补：company code 是稳定的 username → 公司映射锚点。
  // match-contract-service 用此字段与 task.publisher_company_code /
  // claimer_company_code 比对；缺失视为放行（兼容老合同 / 派系合同）。
  partnerCode?: string;
}

export interface MatchResult {
  matched: boolean;
  reason?: string;
}

const PRICE_TOLERANCE = 0.005; // ±0.5%，与前端 RUNCN/contract-link.ts 对齐

// 价格容差判定
function priceEquals(a: number | undefined, b: number | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a === 0 && b === 0) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / max <= PRICE_TOLERANCE;
}

// items 集合相等（commodity 全等，amount 严格，price 容差）
function itemsEqual(
  a: ContractFingerprint['items'],
  b: ContractFingerprint['items'],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.commodity.localeCompare(y.commodity));
  const sortedB = [...b].sort((x, y) => x.commodity.localeCompare(y.commodity));
  for (let i = 0; i < sortedA.length; i++) {
    const ia = sortedA[i]!;
    const ib = sortedB[i]!;
    if (ia.commodity !== ib.commodity) return false;
    if (ia.amount !== ib.amount) return false;
    const pricesMatch: boolean = priceEquals(ia.price, ib.price);
    if (!pricesMatch) return false;
  }
  return true;
}

// 反转规则（与前端 RUNCN/auto-link.ts effectiveTaskTemplate 保持一致）：
//   task BUY + creator=claimer  → 合同是 SELL（接取者卖给发布者）
//   task SELL + creator=claimer → 合同是 BUY（接取者从发布者买）
//   SHIP / creator=publisher   → 不反转
export function effectiveTemplate(
  taskTemplate: TaskContractJson['template'],
  creator: ContractCreator | undefined,
): TaskContractJson['template'] {
  if (taskTemplate === 'SHIP') return 'SHIP';
  if (creator === 'publisher') return taskTemplate;
  return taskTemplate === 'BUY' ? 'SELL' : 'BUY';
}

// 把任务侧 TaskContractJson 转指纹（先应用反转）
function taskJsonToFingerprint(json: TaskContractJson): ContractFingerprint {
  const items: ContractFingerprint['items'] = json.items.map((i: TaskContractItem) => {
    const item: { commodity: string; amount: number; price?: number } = {
      commodity: i.commodity,
      amount: i.amount,
    };
    if (i.price !== undefined) item.price = i.price;
    return item;
  });
  const fp: ContractFingerprint = {
    template: json.template,
    currency: json.currency,
    items,
  };
  if (json.location !== undefined) fp.location = json.location;
  if (json.origin !== undefined) fp.origin = json.origin;
  if (json.destination !== undefined) fp.destination = json.destination;
  if (json.price !== undefined) fp.price = json.price;
  return fp;
}

// 从 items 计算总价（sum of price × amount）
function totalPriceFromItems(items: { commodity: string; amount: number; price?: number }[]): number | undefined {
  const priced = items.filter(i => i.price !== undefined && i.price > 0);
  if (priced.length === 0) return undefined;
  return priced.reduce((sum, i) => sum + i.price! * i.amount, 0);
}

// 权威比对：以 task.contractJson 为 source of truth，
// 应用反转后与前端上报的 fingerprint 严格匹配。
// 注意：partnerName 校验在调用方（matchContractService）里做，
// 取决于 task.publisher_username / claimer_username 与 fingerprint.partnerName 比对。
export function matchContractFingerprint(
  taskJson: TaskContractJson,
  creator: ContractCreator | undefined,
  fingerprint: ContractFingerprint,
): MatchResult {
  const task: ContractFingerprint = taskJsonToFingerprint(taskJson);
  task.template = effectiveTemplate(taskJson.template, creator);

  if (task.template !== fingerprint.template) {
    return {
      matched: false,
      reason: `template mismatch: task=${task.template} fingerprint=${fingerprint.template}`,
    };
  }
  if (task.currency !== fingerprint.currency) {
    return {
      matched: false,
      reason: `currency mismatch: task=${task.currency} fingerprint=${fingerprint.currency}`,
    };
  }
  if (!itemsEqual(task.items, fingerprint.items)) {
    return { matched: false, reason: 'items mismatch' };
  }
  // partnerName：fingerprint 必须带 partnerName（contract.partner.name 解析）。
  // 缺失视为未知 → 跳过校验（让更宽松的 fingerprint 比对通过；调用方
  // 应当已经做了 partner 预筛，否则 false positive 风险高）。
  if (fingerprint.partnerName !== undefined && fingerprint.partnerName === '') {
    return { matched: false, reason: 'partnerName empty' };
  }
  // 顶层 price 比对：BUY/SELL 任务价格在 item 级别，task.contractJson.price
  // 可能是 undefined；合同侧 fingerprint.price 来自 PAYMENT 总金额。
  // 当一方缺失时，从各自 items 反算总价使两侧可比。
  const taskPrice = task.price ?? totalPriceFromItems(task.items);
  const fpPrice = fingerprint.price ?? totalPriceFromItems(fingerprint.items);
  if (!priceEquals(taskPrice, fpPrice)) {
    return {
      matched: false,
      reason: `price mismatch: task=${taskPrice} fingerprint=${fpPrice}`,
    };
  }
  const locA = task.location ?? '';
  const locB = fingerprint.location ?? '';
  if (locA !== locB) {
    return {
      matched: false,
      reason: `location mismatch: task=${locA} fingerprint=${locB}`,
    };
  }
  const originA = task.origin ?? '';
  const originB = fingerprint.origin ?? '';
  if (originA !== originB) {
    return {
      matched: false,
      reason: `origin mismatch: task=${originA} fingerprint=${originB}`,
    };
  }
  const destA = task.destination ?? '';
  const destB = fingerprint.destination ?? '';
  if (destA !== destB) {
    return {
      matched: false,
      reason: `destination mismatch: task=${destA} fingerprint=${destB}`,
    };
  }
  return { matched: true };
}
