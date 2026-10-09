#!/usr/bin/env node

/**
 * Script de Pré-Cadastro em Lote de Vistoriadores no Firebase
 *
 * Exemplo de uso:
 *   INITIAL_PASSWORD="MinhaSenhaInicial123!" node scripts/precadastro-vistoriadores.js --file ./vistoriadores.xlsx [--dry-run] [--project ameta-sistema-teste]
 */

import fs from 'fs';
import path from 'path';
import process from 'process';
import XLSX from 'xlsx';
import admin from 'firebase-admin';

const args = process.argv.slice(2);
function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
}

const isDryRun = args.includes('--dry-run');
const filePath = getArgValue('--file') || getArgValue('-f') || 'vistoriadores.xlsx';
const targetProject = getArgValue('--project') || 'ameta-sistema-teste';
const initialPassword = process.env.INITIAL_PASSWORD || 'ameta2026';

console.log('====================================================');
console.log(' PRÉ-CADASTRO EM LOTE DE VISTORIADORES - AMETA TELECOM');
console.log('====================================================');
console.log(`Projeto Alvo    : ${targetProject}`);
console.log(`Modo Execução   : ${isDryRun ? 'DRY-RUN (Simulação - Nenhuma gravação)' : 'PRODUÇÃO/TESTE (Gravação ativa)'}`);
console.log(`Arquivo Planilha: ${filePath}`);

if (targetProject !== 'ameta-sistema-teste' && !args.includes('--project')) {
  console.error('Erro de Segurança: Por padrão o projeto é "ameta-sistema-teste". Para outro projeto, passe explicitamente --project <project-id>.');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`Erro: Arquivo "${filePath}" não encontrado.`);
  console.log('Crie o arquivo CSV ou XLSX com as colunas: nome, e-mail, equipe, telefone, plataforma');
  process.exit(1);
}

// Inicializar Firebase Admin SDK
let serviceAccountKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountKeyPath) {
  const defaultKey = path.resolve('serviceAccountKey.json');
  if (fs.existsSync(defaultKey)) {
    serviceAccountKeyPath = defaultKey;
  }
}

if (serviceAccountKeyPath && fs.existsSync(serviceAccountKeyPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: targetProject,
  });
} else {
  admin.initializeApp({
    projectId: targetProject,
  });
}

const authAdmin = admin.auth();
const dbAdmin = admin.firestore();

function mapPlatform(rawPlatform) {
  const p = (rawPlatform || 'AMBAS').toString().trim().toUpperCase();
  if (p.includes('NOKIA')) return { plataforma: 'NOKIA', assignedPlatform: 'NOKIA' };
  if (p.includes('ERICSSON') || p.includes('CLARO')) return { plataforma: 'ERICSSON', assignedPlatform: 'ERICSSON' };
  return { plataforma: 'AMBAS', assignedPlatform: 'BOTH' };
}

async function run() {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);

  console.log(`Linhas encontradas na planilha: ${rows.length}\n`);

  let countCreatedAuth = 0;
  let countExistingAuth = 0;
  let countCreatedFirestore = 0;
  let countUpdatedFirestore = 0;
  let countErrors = 0;
  const errorDetails = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row['nome'] || row['Nome'] || row['NOME'] || row['nome completo'] || '';
    const rawEmail = row['e-mail'] || row['email'] || row['Email'] || row['E-mail'] || row['E-MAIL'] || '';
    const rawEquipe = row['equipe'] || row['Equipe'] || row['EQUIPE'] || 'Vistoriadores / Campo';
    const rawTelefone = row['telefone'] || row['Telefone'] || row['TELEFONE'] || row['whatsapp'] || '';
    const rawPlataforma = row['plataforma'] || row['Plataforma'] || row['PLATAFORMA'] || row['cliente'] || 'AMBAS';

    const cleanEmail = (rawEmail || '').toString().trim().toLowerCase();
    const cleanName = (rawName || '').toString().trim();

    if (!cleanEmail || !cleanName) {
      countErrors++;
      errorDetails.push(`Linha ${i + 2}: E-mail ou Nome ausente (${cleanName || 'Sem nome'}, ${cleanEmail || 'Sem e-mail'})`);
      continue;
    }

    const { plataforma, assignedPlatform } = mapPlatform(rawPlataforma);

    try {
      let uid;
      let userRecord;
      try {
        userRecord = await authAdmin.getUserByEmail(cleanEmail);
        uid = userRecord.uid;
        countExistingAuth++;
      } catch (authNotFoundErr) {
        if (!isDryRun) {
          userRecord = await authAdmin.createUser({
            email: cleanEmail,
            password: initialPassword,
            displayName: cleanName,
            emailVerified: true,
          });
          uid = userRecord.uid;
        } else {
          uid = `dry_run_uid_${i}`;
        }
        countCreatedAuth++;
      }

      const userDocRef = dbAdmin.collection('usuarios').doc(uid);

      if (!isDryRun) {
        const userDocSnap = await userDocRef.get();
        const docExists = userDocSnap.exists;

        const userPayload = {
          id: uid,
          uid: uid,
          email: cleanEmail,
          name: cleanName,
          equipe: rawEquipe.toString().trim(),
          telefone: rawTelefone.toString().trim(),
          tipo: 'usuario',
          role: 'Vistoriador',
          situacao: 'ativo',
          accessReleased: true,
          plataforma,
          assignedPlatform,
          mustChangePassword: true,
          batchStatus: 'Aguardando primeiro acesso',
          emailVerified: true,
          updatedAt: new Date().toISOString(),
        };

        if (!docExists) {
          userPayload.createdAt = new Date().toISOString();
          await userDocRef.set(userPayload);
          countCreatedFirestore++;
        } else {
          await userDocRef.set(userPayload, { merge: true });
          countUpdatedFirestore++;
        }
      } else {
        countCreatedFirestore++;
      }

      console.log(`[OK] ${cleanName} (${cleanEmail}) -> ${plataforma}`);
    } catch (rowErr) {
      countErrors++;
      errorDetails.push(`Linha ${i + 2} (${cleanEmail}): ${rowErr.message || rowErr}`);
    }
  }

  console.log('\n====================================================');
  console.log(' RELATÓRIO FINAL DO PRÉ-CADASTRO');
  console.log('====================================================');
  console.log(`Total Analisados : ${rows.length}`);
  console.log(`Criados Auth     : ${countCreatedAuth}`);
  console.log(`Existiam Auth    : ${countExistingAuth}`);
  console.log(`Criados Firestore: ${countCreatedFirestore}`);
  console.log(`Atualizados FS   : ${countUpdatedFirestore}`);
  console.log(`Erros            : ${countErrors}`);

  if (errorDetails.length > 0) {
    console.log('\n--- Detalhes dos Erros ---');
    errorDetails.forEach((e) => console.log(` - ${e}`));
  }
}

run().catch((e) => {
  console.error('Erro fatal na execução do script:', e);
  process.exit(1);
});
