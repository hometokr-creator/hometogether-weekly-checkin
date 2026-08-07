import {
  cleanupProductionValidation,
  getProductionConfiguration,
  readValidationState,
  redactValidationSecrets,
  runProductionPreflight,
  seedProductionValidation,
  verifyProductionData,
} from "./lib";

type Command = "preflight" | "seed" | "verify-db" | "cleanup" | "state";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  switch (command) {
    case "preflight":
      print({ ok: true, ...(await runProductionPreflight()) });
      return;
    case "seed": {
      const state = await seedProductionValidation();
      print({
        ok: true,
        runTag: state.runTag,
        productionUrl: state.productionUrl,
        stateFile: getProductionConfiguration().stateFile,
        scenarios: Object.keys(state.scenarios),
        testAdminCreated: Boolean(state.admin),
        secretsPrinted: false,
      });
      return;
    }
    case "verify-db":
      print({ ok: true, ...(await verifyProductionData()) });
      return;
    case "cleanup":
      print({ ok: true, ...(await cleanupProductionValidation()) });
      return;
    case "state": {
      const state = await readValidationState();
      print({
        runTag: state.runTag,
        productionUrl: state.productionUrl,
        createdAt: state.createdAt,
        verified: state.verified,
        stateFile: getProductionConfiguration().stateFile,
        secretsPrinted: false,
      });
      return;
    }
    default:
      throw new Error("사용법: cli.ts <preflight|seed|verify-db|cleanup|state>");
  }
}

void main().catch(async (error: unknown) => {
  let state;
  try {
    state = await readValidationState();
  } catch {
    state = undefined;
  }
  const message = error instanceof Error ? error.message : "알 수 없는 검증 오류";
  process.stderr.write(`${redactValidationSecrets(message, state)}\n`);
  process.exitCode = 1;
});
