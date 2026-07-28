import matter from 'gray-matter';
import yaml from 'yaml';

matter.engines.yaml = {
  parse: yaml.parse.bind(yaml),
  stringify: function(data, options) {
    return yaml.stringify(data, { lineWidth: 0 });
  }
};

const data = {
  overview: `| Уровень | SNP | Описание |\n| ------------- | ---------------------------------------------------- | ------------------ |\n| Основная | I1 | Гаплогруппа *снип* |\n| Промежуточный | [I-Z2893](https://www.yfull.com/tree/I-Z2893/) | Субклад *снип* |\n| Терминальный | [I-FGC69149](https://www.yfull.com/tree/I-FGC69149/) | Терминальный снип |`
};
console.log(matter.stringify('', data));
