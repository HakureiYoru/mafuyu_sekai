/// <reference types="vite/client" />
declare module 'virtual:changelog' {
  const entries: { version: string; date: string; title: string; highlights: string[] }[];
  export default entries;
}
