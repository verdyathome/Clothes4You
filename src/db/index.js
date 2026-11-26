const backend = process.env.DATA_BACKEND === 'memory' ? require('./memory') : require('./caspio');
module.exports = backend;
