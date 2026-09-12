/** Child-only fault injection exercises the production process handlers. */
await import('../../src/app.js');
process.on('message', (command: string) => {
  if (command === 'exception') setImmediate(() => { throw new Error('Synthetic fatal exception'); });
  if (command === 'rejection') void Promise.reject(new Error('Synthetic unhandled rejection'));
});
