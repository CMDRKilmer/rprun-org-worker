declare namespace UserData {
  interface BalanceHistory {
    v1: UserData.BalanceSheetDataV1[];
    v2: UserData.BalanceSheetDataV2[];
  }

  type BalanceSheetDataV1 = [
    timestamp: number,
    currentAssets: number,
    nonCurrentAssets: number,
    liabilities: number,
  ];

  type BalanceSheetDataV2 = [
    timestamp: number,

    // 流动资产
    cash: number,
    cx: number,
    fx: number,
    mmMaterials: number,
    accountsReceivable: number,
    loansPrincipal: number,
    loansInterest: number,
    cxListedMaterials: number,
    cxInventory: number,
    finishedGoods: number,
    workInProgress: number,
    rawMaterials: number,
    workforceConsumables: number,
    otherItems: number,
    fuelTanks: number,
    materialsInTransit: number,
    materialsReceivable: number,

    // 非流动资产
    infrastructure: number,
    resourceExtraction: number,
    production: number,
    accumulatedDepreciation: number,
    shipsMarketValue: number,
    shipsDepreciation: number,
    accountsReceivable: number,
    materialsInTransit: number,
    materialsReceivable: number,
    loansPrincipal: number,
    hqUpgrades: number,
    arc: number,

    // 流动负债
    accountsPayable: number,
    materialsPayable: number,
    debtsPrincipal: number,
    debtsInterest: number,

    // 非流动负债
    accountsPayable: number,
    materialsPayable: number,
    debtsPrincipal: number,
  ];
}
