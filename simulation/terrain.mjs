const LABELS = {
  stairs: ['Continuous stairs', 'Ten 15 cm risers, a landing, and ten descending steps.'],
  gaps: ['Gaps', 'Three consecutive 60 cm gaps separated by flat ground.'],
  platform: ['Platforms', 'A 12 m run-up, then three 40 cm platforms with 4 m of flat ground between them.'],
  mixed: ['Mixed terrain', 'Continuous stairs, a 60 cm gap, and a 40 cm platform on one course.'],
};

export function makeCourse(kind) {
  if (!Object.hasOwn(LABELS, kind)) throw new Error('Unknown terrain');

  const boxes = [];
  const approachStart = -3;
  const firstObstacle = kind === 'platform' ? 12 : 10;
  let x = approachStart;
  const add = (length, top, style = 'ground') => {
    const bottom = style === 'gap' ? -1.12 : -1;
    boxes.push({ begin: x, end: x + length, top, bottom, width: 4, style });
    x += length;
  };
  const stairs = (count) => {
    for (let i = 1; i <= count; i++) add(0.3, i * 0.15, 'stairs');
    add(2, count * 0.15, 'stairs');
    for (let i = count - 1; i >= 0; i--) add(0.3, i * 0.15, 'stairs');
  };
  const gap = () => add(0.6, -0.9, 'gap');
  const platform = () => add(1.6, 0.4, 'platform');

  add(firstObstacle - approachStart, 0);
  switch (kind) {
    case 'stairs':
      stairs(10);
      break;
    case 'gaps':
      gap();
      add(2.2, 0);
      gap();
      add(2.2, 0);
      gap();
      break;
    case 'platform':
      platform();
      add(4, 0);
      platform();
      add(4, 0);
      platform();
      break;
    case 'mixed':
      stairs(10);
      add(4, 0);
      gap();
      add(4, 0);
      platform();
      break;
  }
  add(4, 0);
  const finish = x - 1;
  if (kind === 'mixed') add(4, 0);
  return { kind, label: LABELS[kind][0], description: LABELS[kind][1], firstObstacle, finish, boxes };
}

export function sceneXML(robotXML, course) {
  const number = (value) => value.toFixed(6);
  const geoms = course.boxes.map(({ begin, end, top, bottom, width }, i) => (
    `<geom name="terrain_${i}" type="box" pos="${number((begin + end) / 2)} 0 ${number((top + bottom) / 2)}" size="${number((end - begin) / 2)} ${width / 2} ${number((top - bottom) / 2)}" friction="1 0.005 0.0001"/>`
  )).join('\n');
  const worldbody = '<worldbody>';
  if (!robotXML.includes(worldbody)) throw new Error('RobotA model has no world body');
  return robotXML.replace(worldbody, `${worldbody}\n${geoms}`);
}
