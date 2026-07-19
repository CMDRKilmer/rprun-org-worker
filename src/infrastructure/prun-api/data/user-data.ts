import { onApiMessage } from '@src/infrastructure/prun-api/data/api-messages';

// 会在 UI 之前初始化，因此不需要 undefined 或回退值。
export const userDataStore = shallowReactive<PrunApi.UserData>({} as PrunApi.UserData);

export const companyContextId = computed(
  () => userDataStore.contexts?.find(x => x.type === 'COMPANY')?.id,
);

onApiMessage({
  USER_DATA(data: PrunApi.UserData) {
    Object.assign(userDataStore, data);
  },
});
