module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promise` is our explicit fire-and-forget marker.
    'no-void': ['warn', { allowAsStatement: true }],
  },
};
