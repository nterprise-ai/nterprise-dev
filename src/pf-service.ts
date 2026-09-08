/** Root-owned, bounded PF reconciliation. No runtime dependency on Bun or a checkout. */
export const PF_LABEL = "dev.nterprise.pfctl";
export const PF_ANCHOR = "dev.nterprise";
export const PF_ANCHOR_PATH = `/etc/pf.anchors/${PF_LABEL}`;
export const PF_HELPER_PATH = "/Library/PrivilegedHelperTools/dev.nterprise.pfctl";
export const PF_DISPATCH = `rdr-anchor "${PF_ANCHOR}"`;
export const PF_LOAD = `load anchor "${PF_ANCHOR}" from "${PF_ANCHOR_PATH}"`;
export const PF_RULE =
	"rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 1355\n";

/** Preserve operator rules; put our dispatcher before other redirects, in PF's NAT section. */
export function configurePfConf(source: string, enabled = true): string {
	const lines = source.split("\n").filter((line) => ![PF_DISPATCH, PF_LOAD].includes(line.trim()));
	if (!enabled) return lines.join("\n");
	const index = lines.findIndex((line) =>
		/^\s*(?:rdr(?:-anchor)?|dummynet-anchor|anchor|load anchor|block|pass)\b/.test(line),
	);
	if (index < 0)
		throw new Error("Unrecognized /etc/pf.conf; configure the nterprise anchor manually.");
	lines.splice(index, 0, PF_DISPATCH);
	return `${lines.join("\n").trimEnd()}\n${PF_LOAD}\n`;
}

export const PF_HELPER = `#!/bin/sh
# Installed root:wheel 0755. launchd runs this at boot and every 30 seconds.
# Never load or flush the main ruleset during unattended recovery.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
rules=$(/sbin/pfctl -sn 2>/dev/null)
if ! printf '%s\\n' "$rules" | /usr/bin/grep -Fqx '${PF_DISPATCH} all'; then
  echo 'nterprise: main PF dispatcher missing; run nterprise doctor --fix interactively.' >&2
  exit 1
fi
current=$(/sbin/pfctl -a ${PF_ANCHOR} -sn 2>/dev/null)
expected='rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port = 443 -> 127.0.0.1 port 1355'
if [ "$current" != "$expected" ]; then
  /sbin/pfctl -a ${PF_ANCHOR} -f ${PF_ANCHOR_PATH}
fi
status=$(/sbin/pfctl -s info 2>/dev/null)
if ! printf '%s\\n' "$status" | /usr/bin/grep -q '^Status: Enabled'; then
  # -e is idempotent; unlike -E it does not leak a reference on every wake.
  /sbin/pfctl -e
fi
`;

export const PF_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${PF_LABEL}</string>
    <key>ProgramArguments</key><array><string>${PF_HELPER_PATH}</string></array>
    <key>RunAtLoad</key><true/>
    <key>StartInterval</key><integer>30</integer>
    <key>ProcessType</key><string>Background</string>
    <key>StandardErrorPath</key><string>/var/log/${PF_LABEL}.log</string>
    <key>StandardOutPath</key><string>/var/log/${PF_LABEL}.log</string>
</dict>
</plist>
`;
