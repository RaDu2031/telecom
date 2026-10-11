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
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import crypto from 'crypto';

function generateRandomSalt(byteLength = 16) {
  return crypto.randomBytes(byteLength).toString('hex');
}

function hashStringWithSalt(plainText, salt) {
  return crypto.createHash('sha256').update(`${salt}:${plainText}`).digest('hex');
}

const args = process.argv.slice(2);
function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
}

const isDryRun = args.includes('--dry-run');
const filePath = getArgValue('--file') || getArgValue('-f') || 'planilha_vistoriadores.xlsx';
const targetProject = getArgValue('--project') || 'ameta-sistema-teste';
const initialPassword = process.env.INITIAL_PASSWORD;

if (!initialPassword || initialPassword.length < 8) {
  console.error('Erro de Segurança: A variável de ambiente INITIAL_PASSWORD é obrigatória e deve ter pelo menos 8 caracteres.');
  console.error('Exemplo de uso: INITIAL_PASSWORD="SenhaSegura123!" node scripts/precadastro-vistoriadores.js --file ./planilha_vistoriadores.xlsx');
  process.exit(1);
}

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
  console.log('Crie o arquivo CSV ou XLSX com as colunas: nome, e-mail, equipe, telefone, plataforma, cpf (opcional)');
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

let app;
if (getApps().length === 0) {
  if (serviceAccountKeyPath && fs.existsSync(serviceAccountKeyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf8'));
    app = initializeApp({
      credential: cert(serviceAccount),
      projectId: targetProject,
    });
  } else {
    app = initializeApp({
      projectId: targetProject,
    });
  }
} else {
  app = getApps()[0];
}

const authAdmin = getAuth(app);
const dbAdmin = getFirestore(app);

function mapPlatform(rawPlatform) {
  const p = (rawPlatform || 'AMBAS').toString().trim().toUpperCase();
  if (p.includes('NOKIA')) return { plataforma: 'NOKIA', assignedPlatform: 'NOKIA' };
  if (p.includes('ERICSSON') || p.includes('CLARO')) return { plataforma: 'ERICSSON', assignedPlatform: 'ERICSSON' };
  return { plataforma: 'AMBAS', assignedPlatform: 'BOTH' };
}

async function run() {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes('EQUIPES') ? 'EQUIPES' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet);

  console.log(`Planilha lida (${sheetName}). Linhas encontradas: ${rawRows.length}\n`);

  let countCreated = 0;
  let countIgnored = 0;
  let countErrors = 0;
  const ignoredEmails = [];
  const createdEmails = [];
  const errorDetails = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rawName = row['nome'] || row['Nome'] || row['NOME'] || row['nome completo'] || row['NOME COMPLETO'] || '';
    const rawEmail = row['e-mail'] || row['email'] || row['Email'] || row['E-mail'] || row['E-MAIL'] || '';
    const rawEquipe = row['equipe'] || row['Equipe'] || row['EQUIPE'] || '1';
    const rawTelefone = row['telefone'] || row['Telefone'] || row['TELEFONE'] || row['whatsapp'] || '';
    const rawPlataforma = row['plataforma'] || row['Plataforma'] || row['PLATAFORMA'] || row['cliente'] || 'AMBAS';
    const rawCpf = row['cpf'] || row['CPF'] || row['Cpf'] || '';

    const cleanEmail = (rawEmail || '').toString().trim().toLowerCase();
    const cleanName = (rawName || '').toString().trim();
    const cleanCpf = (rawCpf || '').toString().trim();

    if (!cleanEmail || !cleanName || !cleanEmail.includes('@')) {
      continue;
    }

    const { plataforma, assignedPlatform } = mapPlatform(rawPlataforma);

    try {
      let existingAuthUser = null;
      try {
        existingAuthUser = await authAdmin.getUserByEmail(cleanEmail);
      } catch (notFound) {
        existingAuthUser = null;
      }

      if (existingAuthUser) {
        countIgnored++;
        ignoredEmails.push(`${cleanEmail} (Já existe no Auth: ${existingAuthUser.uid})`);
        
        // Garante que o e-mail do usuário existente esteja marcado como verificado
        if (!existingAuthUser.emailVerified && !isDryRun) {
          try {
            await authAdmin.updateUser(existingAuthUser.uid, { emailVerified: true });
            console.log(`[AUTH EMAIL_VERIFIED ATUALIZADO] ${cleanEmail}`);
          } catch (verErr) {
            console.warn(`[AVISO] Falha ao marcar emailVerified para ${cleanEmail}:`, verErr);
          }
        }

        if (isDryRun) {
          console.log(`[DRY-RUN IGNORADO - JÁ EXISTE AUTH] ${cleanName} (${cleanEmail})`);
        } else {
          console.log(`[IGNORADO - JÁ EXISTE AUTH] ${cleanName} (${cleanEmail})`);
        }
        continue;
      }

      if (isDryRun) {
        countCreated++;
        createdEmails.push(`${cleanName} (${cleanEmail}) -> DRY-RUN SIMULAÇÃO`);
        console.log(`[DRY-RUN CRIARIA] ${cleanName} (${cleanEmail}) -> ${plataforma}`);
        continue;
      }

      // Real execution: create Auth user first
      const newAuthUser = await authAdmin.createUser({
        email: cleanEmail,
        password: initialPassword,
        displayName: cleanName,
        emailVerified: true,
      });

      const uid = newAuthUser.uid;
      const userDocRef = dbAdmin.collection('usuarios').doc(uid);
      const docSnap = await userDocRef.get();

      if (docSnap.exists) {
        countIgnored++;
        ignoredEmails.push(`${cleanEmail} (Já existe no Firestore: usuarios/${uid})`);
        console.log(`[IGNORADO - DOC FIRESTORE JÁ EXISTIA] ${cleanName} (${cleanEmail})`);
        continue;
      }

      // Dados públicos da coleção usuarios (NÃO contém cpf e NÃO contém initialPasswordHash)
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await userDocRef.set(userPayload);

      // Dados privados na subcoleção usuarios/{uid}/privado/dados
      const salt = generateRandomSalt(16);
      const pwdHash = hashStringWithSalt(initialPassword, salt);
      await userDocRef.collection('privado').doc('dados').set({
        cpf: cleanCpf,
        initialPasswordHash: pwdHash,
        salt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      countCreated++;
      createdEmails.push(`${cleanName} (${cleanEmail}) [UID: ${uid}]`);
      console.log(`[CRIADO SUCESSO] ${cleanName} (${cleanEmail}) -> ${plataforma}`);

    } catch (rowErr) {
      countErrors++;
      errorDetails.push(`Linha ${i + 2} (${cleanEmail}): ${rowErr.message || rowErr}`);
    }
  }

  console.log('\n====================================================');
  console.log(' RELATÓRIO FINAL DO PRÉ-CADASTRO');
  console.log('====================================================');
  console.log(`Total Analisados : ${rawRows.length}`);
  console.log(`Criados          : ${countCreated}`);
  console.log(`Ignorados        : ${countIgnored}`);
  console.log(`Erros            : ${countErrors}`);

  if (createdEmails.length > 0) {
    console.log('\n--- Usuários Criados ---');
    createdEmails.forEach((e) => console.log(` + ${e}`));
  }

  if (ignoredEmails.length > 0) {
    console.log('\n--- Usuários Ignorados (Já Existiam) ---');
    ignoredEmails.forEach((e) => console.log(` - ${e}`));
  }

  if (errorDetails.length > 0) {
    console.log('\n--- Detalhes dos Erros ---');
    errorDetails.forEach((e) => console.log(` ! ${e}`));
  }
}

run().catch((e) => {
  console.error('Erro fatal na execução do script:', e);
  process.exit(1);
});
