export function isValidPackageName(name: string) {
  return /^[ 0-9a-zA-Z.\u4e00-\u9fff-]*$/.test(name);
}

export function stripDeletedActions(pkg: UserData.ActionPackageData) {
  pkg.actions = pkg.actions.filter(action => String(action.type) !== 'Refuel');
  return pkg;
}
