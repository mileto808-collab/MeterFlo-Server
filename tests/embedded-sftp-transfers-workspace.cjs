// Run current transfer acceptance independently of the separate native SQL
// backup/restore acceptance in the comprehensive SFTP workspace suite.
process.env.SFTP_TRANSFER_ONLY = "1";
require("./embedded-sftp-workspace.cjs");
