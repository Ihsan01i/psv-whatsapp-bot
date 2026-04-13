require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

async function testUploads() {
  const content = 'Test,CSV\nRow1,Row2\n';
  const bucket = 'exports';

  console.log('Testing upload with String...');
  let res = await supabase.storage.from(bucket).upload('test1_string.csv', content, {
    contentType: 'text/csv',
    upsert: true
  });
  console.log('String result:', res.error ? res.error.message : res.data);

  console.log('Testing upload with Uint8Array...');
  const uint8array = new TextEncoder().encode(content);
  res = await supabase.storage.from(bucket).upload('test2_uint8array.csv', uint8array, {
    contentType: 'text/csv',
    upsert: true
  });
  console.log('Uint8Array result:', res.error ? res.error.message : res.data);

  console.log('Testing upload with ArrayBuffer...');
  const arrayBuffer = uint8array.buffer;
  res = await supabase.storage.from(bucket).upload('test3_arraybuffer.csv', arrayBuffer, {
    contentType: 'text/csv',
    upsert: true
  });
  console.log('ArrayBuffer result:', res.error ? res.error.message : res.data);

  console.log('Testing upload with Blob...');
  const blob = new Blob([content], { type: 'text/csv' });
  res = await supabase.storage.from(bucket).upload('test4_blob.csv', blob, {
    contentType: 'text/csv',
    upsert: true
  });
  console.log('Blob result:', res.error ? res.error.message : res.data);

  console.log('Testing native JS Buffer...');
  const buf = Buffer.from(content, 'utf-8');
  res = await supabase.storage.from(bucket).upload('test5_buffer.csv', buf, {
    contentType: 'text/csv',
    upsert: true
  });
  console.log('Buffer result:', res.error ? res.error.message : res.data);
}

testUploads();
