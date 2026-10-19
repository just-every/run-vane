-- DASH-007: the page loads and goal events of a filtered report's kept visits, written once per report and deleted when it returns.
CREATE TABLE vane_report_kept(report TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(report,id)) WITHOUT ROWID;
