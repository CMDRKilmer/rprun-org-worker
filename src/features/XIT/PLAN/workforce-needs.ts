// FIO 人口消耗品数据接口与存储。
// 数据来源：https://rest.fnar.net/global/workforceneeds
// Amount 单位：每100人/天。

interface WorkforceNeedItem {
  MaterialTicker: string;
  Amount: number;
}

interface WorkforceNeed {
  WorkforceType: string;
  Needs: WorkforceNeedItem[];
}

export const workforceNeedsStore = shallowReactive<{
  needs: WorkforceNeed[] | undefined;
  fetched: boolean;
}>({
  needs: undefined,
  fetched: false,
});

let fetchStarted = false;

export async function loadWorkforceNeeds() {
  if (fetchStarted) {
    return;
  }
  fetchStarted = true;
  try {
    const resp = await fetch('https://rest.fnar.net/global/workforceneeds');
    if (!resp.ok) {
      return;
    }
    workforceNeedsStore.needs = (await resp.json()) as WorkforceNeed[];
    workforceNeedsStore.fetched = true;
  } catch {
    // 静默失败
  }
}
