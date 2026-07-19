import { onApiMessage } from '@src/infrastructure/prun-api/data/api-messages';

// 会在 UI 之前初始化，因此不需要 undefined 或回退值。
export const uiDataStore = shallowReactive<PrunApi.UIData>({} as PrunApi.UIData);

onApiMessage({
  UI_DATA(data: PrunApi.UIData) {
    Object.assign(uiDataStore, data);
  },
});
