import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";

export const ContentSuite: TestSuite = [
  {name: `Test memberResolve`, test: async () => {
    const content = instance.getContent();

    const member = await content?.memberResolve(`MATH`, [
      {library: `QSYSINC`, name: `MIH`},
      {library: `QSYSINC`, name: `H`}
    ]);

    assert.deepStrictEqual(member, {
      asp: undefined,
      library: `QSYSINC`,
      file: `H`,
      name: `MATH`,
      extension: `MBR`,
      basename: `MATH.MBR`
    });
  }},

  {name: `Test streamfileResolve`, test: async () => {
    const content = instance.getContent();

    const streamfilePath = await content?.streamfileResolve([`git`], [`/QOpenSys/pkgs/sbin`, `/QOpenSys/pkgs/bin`])

    assert.strictEqual(streamfilePath, `/QOpenSys/pkgs/bin/git`);
  }},
];
