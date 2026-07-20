// tests/raw-modules.d.ts
// Vite `?raw` 导入声明（无 import/export，作为 ambient 模块声明）
declare module '*?raw' {
  const content: string;
  export default content;
}
