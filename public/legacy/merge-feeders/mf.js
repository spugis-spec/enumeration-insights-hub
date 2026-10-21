/*
 * Merge Feeders tool (embedded in the Dashboard > Upload Data Files).
 * The processing, folder export and file formats are the same as the standalone MergeFeeders_FINAL2.html.
 * Added: step 5 attaches the processed data to the Upload Data Files boxes (it detects DT / HT Pole /
 * LT Pole / Customer Enumeration / Issue Log) and can generate the report for a chosen date.
 * Runs entirely in the browser. Its libraries (JSZip, PapaParse) are served from this folder, not a CDN.
 */
(function () {
  'use strict';
  if (window.MergeFeeders) return;

  var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');

  var SECTIONS = { dss: 'DT / Substation', ht: 'HT Pole', lt: 'LT Pole', cust: 'Customer Enumeration', issues: 'Issue Log' };
  var DATE_CANDIDATES = ['time', '__created', '__modified'];
  var DEFAULT_KEEP = 'fid, structure_no, structure_number, latitude, longitude, username, model, time, feeder, dss_name, long_x, lat_y, customer_name, landlord_name, connection_status, billing_status, call_back_form_no, customer_no, building_code';

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureLibs() {
    var jobs = [];
    if (!window.JSZip) jobs.push(loadScript(BASE + 'jszip.min.js'));
    if (!window.Papa) jobs.push(loadScript(BASE + 'papaparse.min.js'));
    return Promise.all(jobs).then(function () {
      if (!window.XLSX) throw new Error('The Excel library (SheetJS) is not loaded on this page.');
    });
  }

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  var HTML = '' +
    '<h1>⚡ Merge Feeders — Browser Tool</h1>' +
    '<p class="mf-sub">Runs entirely in your browser — no data leaves your computer. Upload the zipped CSV exports (e.g. ' +
    '<span class="mf-pill">issue_log-csv.zip</span> <span class="mf-pill">lt_pole-csv.zip</span> <span class="mf-pill">ht_pole-csv.zip</span> ' +
    '<span class="mf-pill">distribution_substation-csv.zip</span> <span class="mf-pill">customer_enumeration-csv.zip</span>), ' +
    'pick your date/time column, export streamlined files, then attach them straight to the upload boxes above.</p>' +

    '<div class="mf-card"><h2><span class="mf-step">1</span> Upload zip file(s)</h2>' +
    '<p class="mf-hint">Select one or more .zip files. Each zip should contain a single CSV (or Excel) export.</p>' +
    '<input type="file" id="mf-zipInput" accept=".zip" multiple>' +
    '<div class="mf-btn-row"><button id="mf-loadBtn">Load &amp; Inspect Files</button><span id="mf-loadStatus" class="mf-muted"></span></div></div>' +

    '<div class="mf-card" id="mf-filesCard" style="display:none;"><h2><span class="mf-step">2</span> Choose the date/time source per file</h2>' +
    '<p class="mf-hint">Each file below has its own <code>time</code> (raw timestamp), <code>__created</code> and <code>__modified</code> columns where available. Pick which one should populate the output\'s <b>time</b> column — <code>__created</code> is selected by default when present.</p>' +
    '<table id="mf-filesTable"><thead><tr><th>File</th><th>Rows</th><th>Date/Time source</th><th>Feeder column</th></tr></thead><tbody></tbody></table></div>' +

    '<div class="mf-card" id="mf-keepCard" style="display:none;"><h2><span class="mf-step">3</span> Columns to keep</h2>' +
    '<p class="mf-hint">Comma-separated header names to retain in the streamlined output (matched case-insensitively). Only columns actually present in each file are kept — edit freely. A <b>DT ID</b> column is also added automatically from any column whose header starts with <code>dss_fdr</code>.</p>' +
    '<textarea id="mf-keepFields">' + DEFAULT_KEEP + '</textarea></div>' +

    '<div class="mf-card" id="mf-exportCard" style="display:none;"><h2><span class="mf-step">4</span> Export</h2>' +
    '<p class="mf-hint">Pick a destination folder once (Chrome/Edge) so every output file is written straight there — no zip involved. If your browser doesn\'t support that, files will download individually instead.</p>' +
    '<div class="mf-kv"><div><label class="mf-small">Output format</label>' +
    '<select id="mf-outputFormat"><option value="csv" selected>CSV (.csv) — smaller file size</option><option value="xlsx">Excel worksheet (.xlsx)</option></select>' +
    '<label class="mf-small" style="display:block;margin-top:6px;"><input type="checkbox" id="mf-protectIds" checked> CSV: show full DT ID in Excel (no 5.01E+11)</label></div>' +
    '<div><label class="mf-small">Only include rows dated from</label><input type="date" id="mf-dateFrom"></div>' +
    '<div><label class="mf-small">...through</label><input type="date" id="mf-dateTo"></div></div>' +
    '<p class="mf-hint" style="margin-top:8px;">Filtering uses each file\'s selected date/time column (Step 2). Leave both blank to export every row, unfiltered.</p>' +
    '<div class="mf-btn-row"><button class="mf-secondary" id="mf-pickFolderBtn">📁 Choose output folder</button>' +
    '<span id="mf-folderStatus" class="mf-folder">No folder selected — will fall back to normal downloads.</span></div>' +
    '<div class="mf-btn-row"><button id="mf-processBtn">Process &amp; Export All</button>' +
    '<button class="mf-secondary" id="mf-processOnlyBtn" title="Process the files and go straight to step 5 without saving any export files">Process only (no export)</button></div>' +
    '<div class="mf-log" id="mf-log" style="margin-top:16px; display:none;"></div></div>' +

    '<div class="mf-card" id="mf-attachCard" style="display:none;"><h2><span class="mf-step">5</span> Attach to Upload Data Files</h2>' +
    '<p class="mf-hint">Each processed file is matched to an upload box by its name (and columns): <b>DT / Substation</b>, <b>HT Pole</b>, <b>LT Pole</b>, <b>Customer Enumeration</b> or <b>Issue Log</b>. Check the match, change it if it is wrong, then attach. The files go into the boxes above exactly as if you had uploaded the exported file yourself.</p>' +
    '<table id="mf-attachTable"><thead><tr><th>Processed file</th><th>Rows</th><th>Attach as</th><th>Include</th></tr></thead><tbody></tbody></table>' +
    '<div class="mf-btn-row"><button class="mf-green" id="mf-attachBtn">Attach selected to Upload Data Files</button><span id="mf-attachStatus" class="mf-attachstatus"></span></div>' +
    '<h3>Generate the report for the date you want</h3>' +
    '<p class="mf-hint">Uses the data you attached. Pick one date, or a from–through range, then generate. Nothing needs the internet for this step.</p>' +
    '<div class="mf-kv"><div><label class="mf-small">Report date (from)</label><input type="date" id="mf-repFrom"></div>' +
    '<div><label class="mf-small">...through (optional)</label><input type="date" id="mf-repTo"></div></div>' +
    '<div class="mf-btn-row"><button id="mf-reportBtn">📊 Generate Report</button></div></div>' +

    '<div class="mf-foot">Runs 100% client-side using JSZip, PapaParse and SheetJS. Nothing is uploaded anywhere.</div>';

  function mount(host) {
    host.innerHTML = '<div id="mfTool">' + HTML + '</div>';
    var root = host.firstChild;
    var $ = function (sel) { return root.querySelector(sel); };

    var loadedFiles = []; // { zipName, name, headers[], data[][] (incl header row), dateOptions[], selectedDate, feederMode }
    var processed = [];   // { f, name, result, section, include }
    var dirHandle = null;

    var loadBtn = $('#mf-loadBtn'), zipInput = $('#mf-zipInput'), loadStatus = $('#mf-loadStatus');
    var filesCard = $('#mf-filesCard'), filesTbody = $('#mf-filesTable tbody');
    var keepCard = $('#mf-keepCard'), exportCard = $('#mf-exportCard'), attachCard = $('#mf-attachCard');
    var pickFolderBtn = $('#mf-pickFolderBtn'), folderStatus = $('#mf-folderStatus');
    var processBtn = $('#mf-processBtn'), processOnlyBtn = $('#mf-processOnlyBtn');
    var logEl = $('#mf-log');

    function logLine(msg, cls) {
      logEl.style.display = 'block';
      var div = document.createElement('div');
      div.className = 'line ' + (cls || 'info');
      div.textContent = msg;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function headerIndex(headers, name) {
      var n = name.trim().toLowerCase();
      return headers.findIndex(function (h) { return (h == null ? '' : h).toString().trim().toLowerCase() === n; });
    }

    // ---------- date parsing / ID helpers (unchanged from the standalone tool) ----------
    function pad(n) { return n.toString().padStart(2, '0'); }
    function parseDateValue(raw) {
      if (raw === undefined || raw === null || raw === '') return null;
      if (raw instanceof Date) return isNaN(raw) ? null : raw;
      var s = raw.toString().trim();
      if (s === '') return null;
      if (/^\d{9,11}$/.test(s)) { var d = new Date(parseInt(s, 10) * 1000); if (!isNaN(d)) return d; }
      var d2 = new Date(s.replace(/-/g, '/'));
      if (!isNaN(d2)) return d2;
      return null;
    }
    function formatDate(d) {
      var h = d.getHours(); var ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
      return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
    }
    function numToPlainString(n) {
      if (!isFinite(n)) return String(n);
      if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
      return String(n);
    }
    var SCI_RE = /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i;
    function isSciNotation(v) { return SCI_RE.test((v == null ? '' : v).toString().trim()); }
    function cleanIdValue(v) {
      if (v === undefined || v === null) return '';
      if (typeof v === 'number') return numToPlainString(v);
      return v.toString().trim();
    }

    // ---------- Step 1: load & parse zips ----------
    loadBtn.addEventListener('click', async function () {
      var files = zipInput.files;
      if (!files || files.length === 0) { loadStatus.textContent = 'Please choose at least one .zip file first.'; return; }
      loadBtn.disabled = true;
      loadStatus.textContent = 'Reading...';
      loadedFiles = []; processed = []; attachCard.style.display = 'none';
      filesTbody.innerHTML = '';

      for (var zi = 0; zi < files.length; zi++) {
        var zf = files[zi];
        try {
          var zip = await JSZip.loadAsync(zf);
          var entries = Object.values(zip.files).filter(function (e) { return !e.dir && /\.(csv|xlsx|xls)$/i.test(e.name); });
          for (var ei = 0; ei < entries.length; ei++) {
            var entry = entries[ei];
            var lower = entry.name.toLowerCase();
            var headers = [], data = [];
            if (lower.endsWith('.csv')) {
              var text = await entry.async('string');
              data = Papa.parse(text, { skipEmptyLines: false }).data;
            } else {
              var buf = await entry.async('arraybuffer');
              var wb = XLSX.read(buf, { type: 'array', cellDates: true });
              var ws = wb.Sheets[wb.SheetNames[0]];
              data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
              data = data.map(function (r) { return r.map(function (c) { return (typeof c === 'number') ? numToPlainString(c) : c; }); });
            }
            while (data.length && data[data.length - 1].every(function (c) { return c === '' || c === null || c === undefined; })) data.pop();
            if (data.length === 0) continue;
            headers = data[0].map(function (h) { return (h == null ? '' : h).toString(); });

            var dateOptions = DATE_CANDIDATES.filter(function (c) { return headerIndex(headers, c) >= 0; });
            var feederExisting = headerIndex(headers, 'feeder') >= 0;
            var feeder33 = headerIndex(headers, '_33kv_feeder') >= 0;
            var feeder11 = headerIndex(headers, '_11kv_feeder') >= 0;

            loadedFiles.push({
              zipName: zf.name, name: entry.name, headers: headers, data: data, dateOptions: dateOptions,
              selectedDate: dateOptions.includes('__created') ? '__created' : (dateOptions.includes('time') ? 'time' : (dateOptions[0] || '')),
              feederMode: feederExisting ? 'existing' : ((feeder33 || feeder11) ? 'derived' : 'none')
            });
          }
        } catch (err) {
          logLine('Failed to read ' + zf.name + ': ' + err.message, 'err');
        }
      }

      renderFilesTable();
      loadBtn.disabled = false;
      loadStatus.textContent = loadedFiles.length + ' file(s) ready.';
      var show = loadedFiles.length ? 'block' : 'none';
      filesCard.style.display = show; keepCard.style.display = show; exportCard.style.display = show;
    });

    function renderFilesTable() {
      filesTbody.innerHTML = '';
      loadedFiles.forEach(function (f) {
        var tr = document.createElement('tr');
        var tdName = document.createElement('td');
        tdName.innerHTML = '<span class="mf-filename">' + esc(f.name) + '</span><br><span class="mf-muted" style="font-size:.75rem">' + esc(f.zipName) + '</span>';
        tr.appendChild(tdName);
        var tdRows = document.createElement('td'); tdRows.textContent = (f.data.length - 1).toLocaleString(); tr.appendChild(tdRows);
        var tdSel = document.createElement('td');
        if (f.dateOptions.length === 0) {
          tdSel.innerHTML = '<span class="mf-badge warn">none found</span>';
        } else {
          var sel = document.createElement('select');
          f.dateOptions.forEach(function (opt) {
            var o = document.createElement('option'); o.value = opt; o.textContent = opt;
            if (opt === f.selectedDate) o.selected = true; sel.appendChild(o);
          });
          sel.addEventListener('change', function () { f.selectedDate = sel.value; });
          tdSel.appendChild(sel);
        }
        tr.appendChild(tdSel);
        var tdFeeder = document.createElement('td');
        if (f.feederMode === 'existing') tdFeeder.innerHTML = '<span class="mf-badge ok">feeder column</span>';
        else if (f.feederMode === 'derived') tdFeeder.innerHTML = '<span class="mf-badge ok">33kV/11kV → derived</span>';
        else tdFeeder.innerHTML = '<span class="mf-badge err">not found — will skip</span>';
        tr.appendChild(tdFeeder);
        filesTbody.appendChild(tr);
      });
    }

    // ---------- Step 4a: pick output folder ----------
    pickFolderBtn.addEventListener('click', async function () {
      if (!window.showDirectoryPicker) {
        folderStatus.textContent = 'Your browser does not support folder access — files will download individually.';
        folderStatus.classList.remove('set');
        return;
      }
      try {
        var handle = await window.showDirectoryPicker();
        var opts = { mode: 'readwrite' };
        var perm = await handle.queryPermission(opts);
        if (perm !== 'granted') perm = await handle.requestPermission(opts);
        if (perm !== 'granted') {
          folderStatus.textContent = 'Write permission was not granted — files will download individually instead.';
          folderStatus.classList.remove('set'); dirHandle = null; return;
        }
        dirHandle = handle;
        folderStatus.textContent = 'Output folder selected: "' + dirHandle.name + '". Files will be written directly there.';
        folderStatus.classList.add('set');
      } catch (err) { /* user cancelled the picker */ }
    });

    async function ensureWritePermission(handle) {
      var opts = { mode: 'readwrite' };
      var perm = await handle.queryPermission(opts);
      if (perm !== 'granted') perm = await handle.requestPermission(opts);
      return perm === 'granted';
    }

    function downloadBlob(outBuf, outName, blobType) {
      var blob = new Blob([outBuf], { type: blobType || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = outName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }

    // CSV text for a processed file. `protect` writes DT IDs as ="123..." so Excel (and the Dashboard) keep every digit.
    function buildCsv(result, protect) {
      var rows = result.rows;
      var dtIdx = result.headers.indexOf('DT ID');
      if (dtIdx >= 0 && protect) {
        rows = result.rows.map(function (r) {
          var c = r.slice(); var v = (c[dtIdx] == null ? '' : c[dtIdx]).toString();
          if (/^\d{11,}$/.test(v)) c[dtIdx] = '="' + v + '"';
          return c;
        });
      }
      return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet([result.headers].concat(rows)));
    }

    // ---------- Step 4b: process (& optionally export) ----------
    async function runProcess(doExport) {
      var keepFields = $('#mf-keepFields').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var format = $('#mf-outputFormat').value;
      var fromVal = $('#mf-dateFrom').value, toVal = $('#mf-dateTo').value;
      var fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
      var toDate = toVal ? new Date(toVal + 'T23:59:59') : null;
      if (keepFields.length === 0) { logLine('Please list at least one column to keep.', 'err'); return; }
      if (fromDate && toDate && fromDate > toDate) { logLine('"From" date is after "through" date — please fix the range.', 'err'); return; }
      processBtn.disabled = true; processOnlyBtn.disabled = true;
      logEl.style.display = 'block'; logEl.innerHTML = '';
      processed = []; attachCard.style.display = 'none';
      if (fromDate || toDate) logLine('Filtering to: ' + (fromVal || 'the beginning') + ' → ' + (toVal || 'the end'), 'info');

      for (var i = 0; i < loadedFiles.length; i++) {
        var f = loadedFiles[i];
        try {
          var result = mergeFile(f, keepFields, fromDate, toDate);
          if (result.skipped) { logLine(f.name + ' — skipped (' + result.reason + ')', 'warn'); continue; }
          if (result.dtIdCols.length) logLine(f.name + ' — DT ID built from: ' + result.dtIdCols.join(', '), 'info');
          else logLine(f.name + ' — no dss_fdr* column found, DT ID not added', 'warn');
          if (result.dtIdSciCount) {
            logLine(f.name + ' — WARNING: ' + result.dtIdSciCount.toLocaleString() + ' DT ID values are already in scientific notation (e.g. 5.01101E+11) in the source file. The lost digits cannot be recovered here — re-export the source with DT ID as text.', 'warn');
          }
          var base = f.name.replace(/\.(csv|xlsx|xls)$/i, '');
          var rowLabel = result.filtered
            ? result.rows.length.toLocaleString() + ' of ' + result.totalDataRows.toLocaleString() + ' rows (date-filtered)'
            : result.rows.length.toLocaleString() + ' rows';
          processed.push({ f: f, name: base + '_MERGED', result: result, section: detectSection(f), include: true, rowLabel: rowLabel });

          if (!doExport) { logLine(f.name + ' — ' + rowLabel + ' processed', 'ok'); continue; }

          var outBuf, outName, blobType;
          if (format === 'csv') {
            outBuf = buildCsv(result, $('#mf-protectIds').checked);
            outName = base + '_MERGED.csv'; blobType = 'text/csv';
          } else {
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet([result.headers].concat(result.rows));
            var dtIdx2 = result.headers.indexOf('DT ID');
            if (dtIdx2 >= 0) {
              for (var r = 1; r <= result.rows.length; r++) {
                var cell = ws[XLSX.utils.encode_cell({ r: r, c: dtIdx2 })];
                if (cell && cell.v !== '') { cell.t = 's'; cell.v = String(cell.v); cell.z = '@'; }
              }
            }
            XLSX.utils.book_append_sheet(wb, ws, 'Merged');
            outBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            outName = base + '_MERGED.xlsx'; blobType = 'application/octet-stream';
          }

          var wroteToFolder = false;
          if (dirHandle) {
            try {
              var ok = await ensureWritePermission(dirHandle);
              if (!ok) throw new Error('write permission not granted');
              var fileHandle = await dirHandle.getFileHandle(outName, { create: true });
              var writable = await fileHandle.createWritable();
              await writable.write(outBuf);
              await writable.close();
              wroteToFolder = true;
              logLine(outName + ' — ' + rowLabel + ' written to folder', 'ok');
            } catch (folderErr) {
              logLine(outName + ' — couldn\'t write to folder (' + folderErr.message + '), downloading instead', 'warn');
            }
          }
          if (!wroteToFolder) {
            downloadBlob(outBuf, outName, blobType);
            logLine(outName + ' — ' + rowLabel + ' downloaded', 'ok');
            await new Promise(function (r) { setTimeout(r, 350); });
          }
        } catch (err) {
          logLine(f.name + ' — error: ' + err.message, 'err');
        }
      }

      logLine('Done.' + (processed.length ? ' Step 5 below attaches these to the Upload Data Files.' : ''), 'info');
      processBtn.disabled = false; processOnlyBtn.disabled = false;
      renderAttach();
    }
    processBtn.addEventListener('click', function () { runProcess(true); });
    processOnlyBtn.addEventListener('click', function () { runProcess(false); });

    function mergeFile(f, keepFields, fromDate, toDate) {
      var headers = f.headers, data = f.data, selectedDate = f.selectedDate, feederMode = f.feederMode;
      var col33 = headerIndex(headers, '_33kv_feeder');
      var col11 = headerIndex(headers, '_11kv_feeder');
      var colFeederExisting = headerIndex(headers, 'feeder');
      if (feederMode === 'none') return { skipped: true, reason: 'no feeder column found' };

      var totalDataRows = data.length - 1;
      var filterActive = !!(fromDate || toDate);
      var includedIdx = [];
      var dateColIdxForFilter = selectedDate ? headerIndex(headers, selectedDate) : -1;
      var i, row;

      if (!filterActive || dateColIdxForFilter < 0) {
        for (i = 1; i < data.length; i++) includedIdx.push(i);
      } else {
        for (i = 1; i < data.length; i++) {
          var d = parseDateValue(data[i][dateColIdxForFilter]);
          if (!d) continue;
          if (fromDate && d < fromDate) continue;
          if (toDate && d > toDate) continue;
          includedIdx.push(i);
        }
      }

      var feederVals = null;
      if (feederMode === 'derived') {
        feederVals = new Map();
        includedIdx.forEach(function (ix) {
          row = data[ix];
          var v33 = col33 >= 0 ? (row[col33] == null ? '' : row[col33]).toString().trim() : '';
          if (col33 >= 0 && v33 !== '') feederVals.set(ix, row[col33]);
          else if (col11 >= 0) feederVals.set(ix, row[col11]);
          else feederVals.set(ix, col33 >= 0 ? row[col33] : '');
        });
      }

      var outHeaders = [], mappings = [];
      keepFields.forEach(function (field) {
        var lf = field.toLowerCase();
        if (lf === 'feeder') {
          outHeaders.push('feeder');
          mappings.push(feederMode === 'existing' ? { kind: 'plain', idx: colFeederExisting } : { kind: 'feeder-derived' });
          return;
        }
        if (lf === 'time') {
          if (!selectedDate) return;
          var tIdx = headerIndex(headers, selectedDate);
          if (tIdx >= 0) { outHeaders.push('time'); mappings.push({ kind: 'date', idx: tIdx }); }
          return;
        }
        var idx = headerIndex(headers, field);
        if (idx >= 0) { outHeaders.push(headers[idx]); mappings.push({ kind: 'plain', idx: idx }); }
      });

      // DT ID: merge every column whose header begins with "dss_fdr"; per row the first non-empty value wins.
      var dtIdCols = [];
      headers.forEach(function (h, idx) { if ((h == null ? '' : h).toString().trim().toLowerCase().startsWith('dss_fdr')) dtIdCols.push(idx); });
      if (dtIdCols.length) { outHeaders.push('DT ID'); mappings.push({ kind: 'dtid', idxs: dtIdCols }); }

      var dtIdSciCount = 0, rows = [];
      includedIdx.forEach(function (ix) {
        var src = data[ix], outRow = [];
        mappings.forEach(function (m) {
          if (m.kind === 'feeder-derived') outRow.push(feederVals.get(ix));
          else if (m.kind === 'dtid') {
            var val = '';
            for (var k = 0; k < m.idxs.length; k++) { var v = cleanIdValue(src[m.idxs[k]]); if (v !== '') { val = v; break; } }
            if (val !== '' && isSciNotation(val)) dtIdSciCount++;
            outRow.push(val);
          } else if (m.kind === 'date') {
            var raw = src[m.idx]; var dd = parseDateValue(raw);
            outRow.push(dd ? formatDate(dd) : (raw == null ? '' : raw));
          } else outRow.push(src[m.idx] == null ? '' : src[m.idx]);
        });
        rows.push(outRow);
      });

      return { headers: outHeaders, rows: rows, totalDataRows: totalDataRows, filtered: filterActive, dtIdCols: dtIdCols.map(function (ci) { return headers[ci]; }), dtIdSciCount: dtIdSciCount };
    }

    // ---------- Step 5: detect the upload box, attach, and report ----------
    /** Guess the Dashboard upload box from the file name first, then from its columns. */
    function detectSection(f) {
      var name = (f.zipName + ' ' + f.name).toLowerCase().replace(/[_\-.\s]+/g, ' ');
      if (/\bissues?\b/.test(name)) return 'issues';
      if (/\blt\b|low tension/.test(name)) return 'lt';
      if (/\bht\b|high tension/.test(name)) return 'ht';
      if (/customer|enumeration|\bcust\b/.test(name)) return 'cust';
      if (/distribution|substation|\bdss\b|\bdt\b|transformer/.test(name)) return 'dss';
      var h = f.headers.map(function (x) { return String(x).toLowerCase(); });
      if (h.some(function (x) { return x === 'customer_name' || x === 'landlord_name' || x === 'connection_status' || x === 'call_back_form_no'; })) return 'cust';
      if (h.some(function (x) { return /^issue/.test(x); })) return 'issues';
      return '';
    }

    function renderAttach() {
      var tbody = $('#mf-attachTable tbody');
      tbody.innerHTML = '';
      attachCard.style.display = processed.length ? 'block' : 'none';
      // Only one file fits each upload box: if several are detected for the same box, only the first stays ticked.
      var taken = {};
      processed.forEach(function (p) {
        if (p.section && taken[p.section]) p.include = false;
        else if (p.section) taken[p.section] = true;
      });
      processed.forEach(function (p) {
        var tr = document.createElement('tr');
        var tdN = document.createElement('td');
        tdN.innerHTML = '<span class="mf-filename">' + esc(p.name) + '</span><br><span class="mf-muted" style="font-size:.75rem">' + esc(p.rowLabel) + '</span>';
        tr.appendChild(tdN);
        var tdR = document.createElement('td'); tdR.textContent = p.result.rows.length.toLocaleString(); tr.appendChild(tdR);
        var tdS = document.createElement('td');
        var sel = document.createElement('select');
        var opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = '— choose —'; sel.appendChild(opt0);
        Object.keys(SECTIONS).forEach(function (k) {
          var o = document.createElement('option'); o.value = k; o.textContent = SECTIONS[k]; if (p.section === k) o.selected = true; sel.appendChild(o);
        });
        sel.addEventListener('change', function () { p.section = sel.value; renderAttach(); });
        tdS.appendChild(sel);
        if (!p.section) { var nb = document.createElement('span'); nb.className = 'mf-badge warn'; nb.style.marginLeft = '6px'; nb.textContent = 'not detected'; tdS.appendChild(nb); }
        tr.appendChild(tdS);
        var tdI = document.createElement('td');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.include && !!p.section; cb.disabled = !p.section;
        cb.addEventListener('change', function () { p.include = cb.checked; });
        tdI.appendChild(cb); tr.appendChild(tdI);
        tbody.appendChild(tr);
      });
    }

    function setAttachStatus(msg, color) { var el = $('#mf-attachStatus'); el.textContent = msg; el.style.color = color || ''; }
    function pendingReads() { try { return pendingUploadReads; } catch (e) { return 0; } }

    $('#mf-attachBtn').addEventListener('click', async function () {
      if (typeof window.handleFileUpload !== 'function') { setAttachStatus('The upload boxes were not found on this page.', '#f87171'); return; }
      var picks = processed.filter(function (p) { return p.include && p.section; });
      if (!picks.length) { setAttachStatus('Nothing selected. Pick an upload box for at least one file.', '#fbbf24'); return; }
      var seen = {}, dup = null;
      picks.forEach(function (p) { if (seen[p.section]) dup = p.section; seen[p.section] = true; });
      if (dup) { setAttachStatus('Two files are set to ' + SECTIONS[dup] + '. Only one file fits each upload box: untick or change one.', '#f87171'); return; }

      var btn = $('#mf-attachBtn'); btn.disabled = true; setAttachStatus('Attaching…');
      try {
        for (var i = 0; i < picks.length; i++) {
          var p = picks[i];
          var input = document.getElementById('file-' + p.section);
          if (!input) throw new Error('No upload box for ' + SECTIONS[p.section]);
          // The same bytes you would upload by hand: the exported CSV (DT IDs protected as text).
          var file = new File([buildCsv(p.result, true)], p.name + '.csv', { type: 'text/csv' });
          var dt = new DataTransfer(); dt.items.add(file);
          input.files = dt.files;
          window.handleFileUpload(input, p.section);
          await new Promise(function (r) { setTimeout(r, 60); });
          var waited = 0;
          while (pendingReads() > 0 && waited < 60000) { await new Promise(function (r) { setTimeout(r, 100); }); waited += 100; }
        }
        setAttachStatus('Attached ' + picks.length + ' file(s): ' + picks.map(function (p) { return SECTIONS[p.section]; }).join(', ') + '. Now pick the report date below.', '#4ade80');
        if (!$('#mf-repFrom').value) { $('#mf-repFrom').value = $('#mf-dateFrom').value; $('#mf-repTo').value = $('#mf-dateTo').value; }
      } catch (err) {
        setAttachStatus('Could not attach: ' + err.message, '#f87171');
      } finally { btn.disabled = false; }
    });

    $('#mf-reportBtn').addEventListener('click', function () {
      var from = $('#mf-repFrom').value, to = $('#mf-repTo').value;
      if (!from) { setAttachStatus('Pick the report date first.', '#fbbf24'); return; }
      var startEl = document.getElementById('startDate'), endEl = document.getElementById('endDate');
      if (!startEl || !endEl || typeof window.generateReport !== 'function') { setAttachStatus('The Dashboard report controls were not found.', '#f87171'); return; }
      var range = !!(to && to !== from);
      var radio = document.querySelector('input[name="dateMode"][value="' + (range ? 'range' : 'single') + '"]');
      if (radio) radio.checked = true;
      startEl.value = from;
      if (typeof window.toggleDateMode === 'function') window.toggleDateMode();
      endEl.value = range ? to : from;
      setAttachStatus('Report requested for ' + from + (range ? ' to ' + to : '') + '. Open it with the Take me to Dashboard button.');
      window.generateReport();
    });
  }

  window.MergeFeeders = { mount: mount, ensureLibs: ensureLibs };
})();
