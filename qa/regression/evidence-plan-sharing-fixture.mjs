// Real SQL and HTTP, but never the application's database or storage.
// This starts a private, disposable PostgreSQL cluster using Unix sockets only.
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import pg from 'pg';

export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ids = {
  plan: id(1), otherPlan: id(2), level: id(10), otherLevel: id(11),
  unit: id(20), secondUnit: id(21), otherUnit: id(22),
  entry: id(30), secondEntry: id(31), unselectedEntry: id(32), otherEntry: id(33),
};
export const fileKeys = {
  image: `evidence-plans/${ids.plan}/background.png`,
  otherImage: `evidence-plans/${ids.otherPlan}/background.png`,
  doc: `evidence-plans/${ids.plan}/taf.pdf`,
  secondDoc: `evidence-plans/${ids.plan}/second.xlsx`,
  unselectedDoc: `evidence-plans/${ids.plan}/private.pdf`,
  otherDoc: `evidence-plans/${ids.otherPlan}/other.pdf`,
};

export async function createSharingFixture(createRouters, initializeSchema) {
  // macOS's usual temporary directory can exceed PostgreSQL's socket-path limit.
  const directory = await mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'bgp-sharing-test-'));
  const data = path.join(directory, 'data');
  const socket = path.join(directory, 'socket');
  const log = path.join(directory, 'postgres.log');
  let db, server, started = false;
  const files = new Map();
  const fileReads = [];
  const commands = [];
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
  const cleanup = async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(socket, { mode: 0o700 });
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'qa_share', '--no-locale', '-E', 'UTF8']);
    run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '20', '-o',
      `-k ${socket} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`, 'start']);
    started = true;
    db = new pg.Pool({ host: socket, port: 5432, database: 'postgres', user: 'qa_share', max: 8 });
    await db.query(`
      CREATE TABLE users (id text PRIMARY KEY,email text,role text,is_active boolean);
      CREATE TABLE evidence_plans (
        id uuid PRIMARY KEY, name text, property_id text, background_key text,
        background_width integer, background_height integer, created_by text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), dot_colours jsonb);
      CREATE TABLE evidence_plan_levels (
        id uuid PRIMARY KEY, plan_id uuid, name text, background_key text,
        background_width integer, background_height integer, sort_order integer DEFAULT 0,
        created_at timestamptz DEFAULT now());
      CREATE TABLE evidence_plan_units (
        id uuid PRIMARY KEY, plan_id uuid, level_id uuid, unit_ref text, tenant_name text,
        polygon jsonb, dot jsonb, source text, notes text, tenancy_unit_id text,
        lease_start date, lease_expiry date, break_date date, review_date date, outside_lt_act text,
        erv numeric, passing_rent numeric, sqft numeric, updated_at timestamptz DEFAULT now());
      CREATE TABLE evidence_plan_entries (
        id uuid PRIMARY KEY, plan_id uuid, unit_id uuid, unit_ref text, tenant text,
        transaction_type text, transaction_date date, size_sqft numeric, zone_a numeric,
        net_zone_a numeric, itza numeric, headline_rent numeric, net_effective numeric,
        term text, concession text, notes text, source_key text, created_by text,
        created_at timestamptz DEFAULT now());
      CREATE TABLE tenancy_schedule_units (
        id text PRIMARY KEY, property_id text, unit_number text, trading_name text, tenant_name text,
        floor_level text, permitted_use text, premises text, lease_start date, lease_expiry date,
        break_date date, next_review_date date, outside_lt_act text, erv_pa numeric,
        passing_rent_pa numeric, nia_sqft numeric, gia_sqft numeric, comments text,
        underwriting_comments text, updated_at timestamptz DEFAULT now());
    `);
    await initializeSchema(db);
    const tracked = {
      query: async (sql, values) => { commands.push(String(sql)); return db.query(sql, values); },
      connect: async () => {
        const client = await db.connect();
        return {
          query: async (sql, values) => { commands.push(String(sql)); return client.query(sql, values); },
          release: () => client.release(),
        };
      },
    };
    const routers = createRouters({
      db: tracked,
      requireAuth: (req, res, next) => {
        const role = req.get('x-test-user');
        if (!role) return res.status(401).json({ error: 'Authentication required' });
        if (role === 'disabled') return res.status(403).json({ error: 'Account disabled' });
        req.session = { userId: ['deleted', 'disabled-row', 'external', 'client-row'].includes(role) ? role : 'synthetic-user' };
        req.testRole = role;
        next();
      },
      isClientRequestUser: async req => req.testRole === 'client' || req.testRole === 'unmapped-client',
      resolveCompanyScope: async req => req.testRole === 'client' || req.testRole === 'staff-client-view' ? 'client-scope' : null,
      getFile: async key => {
        fileReads.push(key);
        const file = files.get(key);
        if (file instanceof Error) throw file;
        return file || null;
      },
      ensureSchema: async () => {},
    });
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use(routers.publicRouter);
    app.use(routers.staffRouter);
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: 'Fixture request failed' }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (url, { method = 'GET', body, user, headers = {}, signal } = {}) => {
      const multipart = body instanceof FormData;
      const response = await fetch(baseUrl + url, {
        method, signal, headers: { ...(body !== undefined && !multipart ? { 'content-type': 'application/json' } : {}),
          ...(user ? { 'x-test-user': user } : {}), ...headers },
        ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, headers: response.headers, text, json };
    };
    const reset = async () => {
      await db.query(`TRUNCATE evidence_plan_shares, evidence_plan_entries, evidence_plan_units,
        evidence_plan_levels, evidence_plans, tenancy_schedule_units, users CASCADE`);
      await db.query(`INSERT INTO users VALUES
        ('synthetic-user','qa@brucegillinghampollard.com','Staff',true),
        ('disabled-row','qa-disabled@brucegillinghampollard.com','Staff',false),
        ('external','external@example.test','Staff',true),
        ('client-row','qa-client@brucegillinghampollard.com','Client',true)`);
      await db.query(`INSERT INTO evidence_plans (id,name,property_id,background_key,background_width,background_height,created_by)
        VALUES ($1,'Shared scheme','property-a',$3,1000,800,'PRIVATE-CREATOR'),
          ($2,'OTHER-PLAN-SECRET','property-b',$4,1000,800,'OTHER-CREATOR')`,
      [ids.plan, ids.otherPlan, fileKeys.image, fileKeys.otherImage]);
      await db.query(`INSERT INTO evidence_plan_levels (id,plan_id,name,background_key,background_width,background_height)
        VALUES ($1,$2,'Ground',$3,1000,800),($4,$5,'OTHER-LEVEL-SECRET',$6,1000,800)`,
      [ids.level, ids.plan, fileKeys.image, ids.otherLevel, ids.otherPlan, fileKeys.otherImage]);
      for (const [uid, pid, lid, ref, tenant] of [
        [ids.unit, ids.plan, ids.level, 'A1', 'Selected tenant'],
        [ids.secondUnit, ids.plan, ids.level, 'A2', 'Second tenant'],
        [ids.otherUnit, ids.otherPlan, ids.otherLevel, 'B1', 'OTHER-UNIT-SECRET'],
      ]) await db.query(`INSERT INTO evidence_plan_units
        (id,plan_id,level_id,unit_ref,tenant_name,polygon,dot,source,notes,erv,passing_rent,sqft)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'PRIVATE-SOURCE','PRIVATE-UNIT-NOTE',0,0,0)`,
      [uid, pid, lid, ref, tenant, JSON.stringify([{ x: .1, y: .1 }, { x: .4, y: .1 }, { x: .4, y: .4 }]), JSON.stringify({ x: .2, y: .2 })]);
      for (const [eid, pid, uid, key, tenant] of [
        [ids.entry, ids.plan, ids.unit, fileKeys.doc, 'Selected tenant'],
        [ids.secondEntry, ids.plan, ids.secondUnit, fileKeys.secondDoc, 'Second tenant'],
        [ids.unselectedEntry, ids.plan, ids.unit, fileKeys.unselectedDoc, 'UNSELECTED-ENTRY-SECRET'],
        [ids.otherEntry, ids.otherPlan, ids.otherUnit, fileKeys.otherDoc, 'OTHER-ENTRY-SECRET'],
      ]) await db.query(`INSERT INTO evidence_plan_entries
        (id,plan_id,unit_id,unit_ref,tenant,transaction_type,transaction_date,size_sqft,zone_a,net_zone_a,
          itza,headline_rent,net_effective,term,concession,notes,source_key,created_by)
        VALUES ($1,$2,$3,'A1',$4,'Letting','2026-01-01',0,0,0,0,0,0,'10 years','None',
          'PRIVATE-ENTRY-NOTE',$5,'PRIVATE-CREATOR')`, [eid, pid, uid, tenant, key]);
      files.clear();
      const file = (data, contentType, originalName) => ({ data: Buffer.from(data), contentType, originalName, size: Buffer.byteLength(data) });
      files.set(fileKeys.image, file(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('synthetic-plan-image')]), 'image/png', 'plan.png'));
      files.set(fileKeys.otherImage, file(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('OTHER-IMAGE-SECRET')]), 'image/png', 'other.png'));
      files.set(fileKeys.doc, file('%PDF-1.4 synthetic approved PDF', 'application/pdf', 'approved.pdf'));
      files.set(fileKeys.secondDoc, file(Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('synthetic-approved-workbook')]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'approved.xlsx'));
      files.set(fileKeys.unselectedDoc, file('UNSELECTED-DOCUMENT-SECRET', 'application/pdf', 'private.pdf'));
      files.set(fileKeys.otherDoc, file('OTHER-DOCUMENT-SECRET', 'application/pdf', 'other.pdf'));
      commands.length = 0;
      fileReads.length = 0;
    };
    return { db, files, fileReads, commands, request, reset, cleanup, directory };
  } catch (error) {
    if (started) error.message += `\nDisposable PostgreSQL log:\n${await readFile(log, 'utf8').catch(() => '')}`;
    await cleanup();
    throw error;
  }
}
