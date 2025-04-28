module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo', 'nativewind/babel'], // Убрали jsxImportSource и оставили 'nativewind/babel' отдельно
  };
};
