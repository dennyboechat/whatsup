#!/usr/bin/env node
/**
 * Shows whether the local DB has messages for TARGET_GROUP_NAME and summarization checkpoint state.
 */
const { formatStatusText } = require('../utils/statusText');

console.log(formatStatusText());
