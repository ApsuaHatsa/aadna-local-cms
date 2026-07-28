import matter from 'gray-matter';
const data = {
  overview: `| Уровень |\n\n| --------- |\n\n| Основная |`
};
console.log(matter.stringify('', data, { lineWidth: -1 }));
