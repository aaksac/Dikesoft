export const state = {
  user: null, rows: [], reportRows: [], channels: [], dealers: [], mails: [], reports: [],
  importRows: [], importPeriod: null, importFileName: "", importSelectedRowIds: new Set(),
  selectedReportIds: new Set(), selectedRowIds: new Set(), sendLogs: [], currentPeriod: null, currentReportPeriod: null, currentReportMonths: [], currentReportDistributor: "", currentReportDistributors: [], pendingSave: false, pendingFileName: "",
  settings: { companyName: "", defaultSubject: "Hesap Özeti Raporu" }
};
