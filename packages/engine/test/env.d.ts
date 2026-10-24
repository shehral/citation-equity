// Vite inlines `?raw` imports as strings; declared here so fixtures load without Node types.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
declare module '*.html?raw' {
  const content: string;
  export default content;
}
declare module '*.csv?raw' {
  const content: string;
  export default content;
}
