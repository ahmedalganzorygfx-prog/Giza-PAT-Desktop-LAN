'use strict';
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const match = source.match(/function mergeById\([\s\S]*?\n\}/);
if (!match) throw new Error('mergeById not found');
const mergeById = vm.runInNewContext(`${match[0]}; mergeById`);
function assert(ok, message) { if (!ok) throw new Error(message); }
function uniqueIds(rows) { return new Set(rows.map(x => String(x.id))).size === rows.length; }

// Two independent clients add the same next numeric ID.
const base = [];
const first = [{id:1,name:'Client 1'}];
const afterFirst = mergeById(base, first, []);
const second = [{id:1,name:'Client 2'}];
const afterSecond = mergeById(base, second, afterFirst);
assert(afterSecond.length === 2, 'concurrent inserts must both survive');
assert(uniqueIds(afterSecond), 'concurrent inserts must receive unique IDs');

// Independent additions based on a non-empty common snapshot.
const snapshot = [{id:1,name:'Existing'}];
const live = mergeById(snapshot, [...snapshot,{id:2,name:'A'}], snapshot);
const both = mergeById(snapshot, [...snapshot,{id:2,name:'B'}], live);
assert(both.length === 3 && uniqueIds(both), 'parallel additions must merge without loss');

// Last save wins for edits to the same record.
const edited = mergeById(snapshot, [{id:1,name:'Edit B'}], [{id:1,name:'Edit A'}]);
assert(edited[0].name === 'Edit B', 'latest same-record edit should win');

// A stale delete must not erase a record concurrently edited by another client.
const staleDelete = mergeById(snapshot, [], [{id:1,name:'Concurrent edit'}]);
assert(staleDelete.length === 1 && staleDelete[0].name === 'Concurrent edit', 'stale delete must preserve concurrent edit');

// An uncontested delete should be applied.
const deleted = mergeById(snapshot, [], snapshot);
assert(deleted.length === 0, 'uncontested delete should apply');

console.log('PASS: concurrent add, unique IDs, independent edits, same-record last-write, and delete reconciliation');
