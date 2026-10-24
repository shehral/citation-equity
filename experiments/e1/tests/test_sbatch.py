"""The E1 Explorer job scripts hold no personal cluster details and read site settings from local.env.

Each script is run with bash (never sbatch) in dry-run mode (CE_DRY_RUN=1), which resolves the
settings, prints them and exits before loading modules or touching the GPU. Shims named sbatch,
module, nvidia-smi and srun sit first on PATH and record any call, so a test fails if one runs.

Run: python3 -I -m unittest discover -s experiments/e1/tests
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

E1 = Path(__file__).resolve().parents[1]
REPO = E1.parents[1]
SCRIPTS = ["edit.sbatch", "generate.sbatch", "normalize.sbatch"]
REQUIRED = ["CE_ROOT", "CE_PYTHON", "HF_HOME"]  # every script stops without each of these
# Run parameters generate.sbatch needs before it reads any site setting.
RUN_PARAMS = {"generate.sbatch": {"JUDGE": "gemma-4-12b", "BATCH": "main.gemma-4-12b.tier1"}}
PLACEHOLDERS = {
    "SBATCH_ACCOUNT": "test-allocation",
    "CE_ROOT": "/cluster/project/citation-equity",
    "CE_PYTHON": "/cluster/project/env/bin/python",
    "HF_HOME": "/cluster/cache/hf",
    "CE_CUDA_COMPAT": "/cluster/project/cuda-compat",
    "CE_MODULES": "mod-a/1 mod-b/2",
    "CE_NODE": "/cluster/node-22/bin/node",
}
# The brief's grep pattern for personal cluster details. Built from fragments so this file never
# matches it: a literal would make the grep below find this line, and would put the account
# prefix in the repo.
PERSONAL_TERMS = ["cs" + "6120", "sheh" + "ral", "/projects/" + "interpretability", "/scr" + "atch/"]
PERSONAL = "|".join(PERSONAL_TERMS)
# Lines every E1 job must carry byte for byte, so the site-settings block cannot drift between them.
SHARED_LINES = [
    'LOCAL_ENV="${SLURM_SUBMIT_DIR:-.}/local.env"',
    '[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"',
    ': "${CE_ROOT:?set CE_ROOT to the project folder on the cluster (see local.env.example)}"',
    "PROJ=$CE_ROOT",
    "MODULES=${CE_MODULES-miniconda3/24.11.1}",
    '  echo "  SBATCH_ACCOUNT=${SBATCH_ACCOUNT:-<unset: the cluster default>}"',
    '  echo "  logs=${SBATCH_OUTPUT:-%x-%j.out in the submit folder}"',
    "source /etc/profile",
    "module purge",
    'for m in $MODULES; do module load "$m"; done',
    'export PATH=$(dirname "$CE_PYTHON"):$PATH',
    "PYTHON=$CE_PYTHON",
    "export HF_HOME",
    "export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1"
    " HF_HUB_DISABLE_PROGRESS_BARS=1",
    "unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY",
]
# The CUDA forward-compat line, in each job that loads torch on the GPU.
CUDA_COMPAT_LINE = '[ -n "${CE_CUDA_COMPAT:-}" ] && export LD_LIBRARY_PATH=$CE_CUDA_COMPAT:$LD_LIBRARY_PATH'


def write_local_env(folder: Path, values: dict[str, str]) -> None:
    lines = [f'export {k}="{v}"' for k, v in values.items()]
    (folder / "local.env").write_text("\n".join(lines) + "\n", encoding="utf-8")


class Run:
    """One dry run of a script from a temporary submit folder with a minimal environment."""

    def __init__(self, script: str, local_env: dict[str, str] | None, extra_env: dict[str, str] | None = None):
        with tempfile.TemporaryDirectory() as tmp:
            submit, shims = Path(tmp) / "submit", Path(tmp) / "shims"
            submit.mkdir()
            shims.mkdir()
            marker = Path(tmp) / "called"
            for name in ("sbatch", "module", "nvidia-smi", "srun"):
                shim = shims / name
                shim.write_text(f'#!/bin/sh\necho "{name} $*" >> "{marker}"\nexit 1\n', encoding="utf-8")
                shim.chmod(0o755)
            if local_env is not None:
                write_local_env(submit, local_env)
            env = {
                "PATH": f"{shims}{os.pathsep}/usr/bin{os.pathsep}/bin",
                "HOME": tmp,
                "SLURM_SUBMIT_DIR": str(submit),
                "CE_DRY_RUN": "1",
                **RUN_PARAMS.get(script, {}),
                **(extra_env or {}),
            }
            proc = subprocess.run(
                ["bash", str(E1 / script)], cwd=submit, env=env, capture_output=True, text=True, timeout=30
            )
            self.code, self.out, self.err = proc.returncode, proc.stdout, proc.stderr
            self.called = marker.read_text(encoding="utf-8") if marker.exists() else ""


class StaticChecks(unittest.TestCase):
    def test_each_script_parses(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                proc = subprocess.run(["bash", "-n", str(E1 / script)], capture_output=True, text=True)
                self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_no_account_line_and_logs_go_to_the_submit_folder(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                text = (E1 / script).read_text(encoding="utf-8")
                self.assertNotRegex(text, r"(?m)^#SBATCH\s+(--account|-A)\b")
                self.assertRegex(text, r"(?m)^#SBATCH --output=%x-%j\.out$")
                self.assertRegex(text, r"(?m)^#SBATCH --error=%x-%j\.err$")

    def test_no_personal_cluster_details_under_experiments(self):
        if shutil.which("git") is None or not (REPO / ".git").exists():
            self.skipTest("not a git checkout")
        proc = subprocess.run(
            ["git", "grep", "-n", "-E", PERSONAL, "--", "experiments"], cwd=REPO, capture_output=True, text=True
        )
        self.assertEqual(proc.stdout, "", "personal cluster details found:\n" + proc.stdout)
        self.assertEqual(proc.returncode, 1, proc.stderr)

    def test_the_personal_pattern_still_catches_each_term(self):
        pattern = re.compile(PERSONAL)
        for term in PERSONAL_TERMS:
            with self.subTest(term=term):
                self.assertRegex(f"x{term}y", pattern)
        self.assertEqual(len(PERSONAL_TERMS), 4)

    def test_this_file_holds_no_literal_personal_term(self):
        text = Path(__file__).read_text(encoding="utf-8")
        self.assertIsNone(re.search(PERSONAL, text))

    def test_the_site_settings_lines_match_across_the_jobs(self):
        for script in SCRIPTS:
            lines = (E1 / script).read_text(encoding="utf-8").splitlines()
            for line in SHARED_LINES:
                with self.subTest(script=script, line=line):
                    self.assertEqual(lines.count(line), 1)
        for script in ("edit.sbatch", "generate.sbatch"):
            with self.subTest(script=script, line=CUDA_COMPAT_LINE):
                lines = (E1 / script).read_text(encoding="utf-8").splitlines()
                self.assertEqual(lines.count(CUDA_COMPAT_LINE), 1)

    def test_real_local_env_files_are_gitignored(self):
        if shutil.which("git") is None or not (REPO / ".git").exists():
            self.skipTest("not a git checkout")
        for folder in ("experiments/e1", "experiments/explorer"):
            with self.subTest(folder=folder):
                proc = subprocess.run(
                    ["git", "check-ignore", "-q", f"{folder}/local.env"], cwd=REPO, capture_output=True
                )
                self.assertEqual(proc.returncode, 0, f"{folder}/local.env is not ignored")


class DryRun(unittest.TestCase):
    def test_prints_the_resolved_settings_without_calling_sbatch_or_modules(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                run = Run(script, PLACEHOLDERS)
                self.assertEqual(run.code, 0, run.out + run.err)
                self.assertEqual(run.called, "")
                for name in ("CE_ROOT", "CE_PYTHON", "HF_HOME", "CE_MODULES"):
                    self.assertIn(f"{name}={PLACEHOLDERS[name]}", run.out)
                self.assertIn("logs=", run.out)

    def test_edit_resolves_node_and_its_paths_under_ce_root(self):
        run = Run("edit.sbatch", PLACEHOLDERS)
        self.assertEqual(run.code, 0, run.out + run.err)
        root = PLACEHOLDERS["CE_ROOT"]
        self.assertIn(f"CE_NODE={PLACEHOLDERS['CE_NODE']}", run.out)
        self.assertIn(f"CE_CUDA_COMPAT={PLACEHOLDERS['CE_CUDA_COMPAT']}", run.out)
        self.assertIn(f"E1={root}/code/e1", run.out)
        self.assertIn(f"DATA={root}/data/e1", run.out)

    def test_generate_resolves_its_batch_paths_under_ce_root(self):
        run = Run("generate.sbatch", PLACEHOLDERS)
        self.assertEqual(run.code, 0, run.out + run.err)
        root = PLACEHOLDERS["CE_ROOT"]
        self.assertIn(f"PROMPTS={root}/e1/batches/main.gemma-4-12b.tier1.prompts.jsonl", run.out)
        self.assertIn(f"OUT={root}/e1/answers/main.gemma-4-12b.tier1.jsonl", run.out)

    def test_settings_can_come_from_the_environment_without_local_env(self):
        run = Run("normalize.sbatch", None, PLACEHOLDERS)
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"CE_ROOT={PLACEHOLDERS['CE_ROOT']}", run.out)

    def test_logs_go_under_ce_root_logs_when_sbatch_output_is_set(self):
        logs = {
            **PLACEHOLDERS,
            "SBATCH_OUTPUT": f"{PLACEHOLDERS['CE_ROOT']}/logs/%x-%j.out",
            "SBATCH_ERROR": f"{PLACEHOLDERS['CE_ROOT']}/logs/%x-%j.err",
        }
        run = Run("edit.sbatch", logs)
        self.assertEqual(run.code, 0, run.out + run.err)
        self.assertIn(f"logs={PLACEHOLDERS['CE_ROOT']}/logs/%x-%j.out", run.out)

    def test_the_committed_example_sources_cleanly(self):
        example = (E1 / "local.env.example").read_text(encoding="utf-8")
        values = dict(re.findall(r'(?m)^export (\w+)="([^"]*)"$', example))
        for name in ("CE_ROOT", "CE_PYTHON", "HF_HOME", "SBATCH_ACCOUNT"):
            self.assertIn(name, values)
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copy(E1 / "local.env.example", Path(tmp) / "local.env")
            proc = subprocess.run(
                ["bash", "-c", '. ./local.env && printf "%s\\n" "$CE_ROOT"'],
                cwd=tmp,
                env={"PATH": "/usr/bin:/bin"},
                capture_output=True,
                text=True,
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), values["CE_ROOT"])


class MissingSettings(unittest.TestCase):
    def test_each_required_setting_fails_fast_with_a_clear_message(self):
        for script in SCRIPTS:
            for name in REQUIRED:
                with self.subTest(script=script, missing=name):
                    values = {k: v for k, v in PLACEHOLDERS.items() if k != name}
                    run = Run(script, values)
                    self.assertNotEqual(run.code, 0)
                    self.assertIn(f"set {name}", run.err)
                    self.assertIn("local.env.example", run.err)
                    self.assertEqual(run.called, "")
                    self.assertNotIn("resolved settings", run.out)

    def test_no_local_env_and_no_environment_fails_fast(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                run = Run(script, None)
                self.assertNotEqual(run.code, 0)
                self.assertIn("set CE_ROOT", run.err)
                self.assertEqual(run.called, "")


if __name__ == "__main__":
    unittest.main()
