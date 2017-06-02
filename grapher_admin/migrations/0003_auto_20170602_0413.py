# -*- coding: utf-8 -*-
# Generated by Django 1.11 on 2017-06-02 04:13
from __future__ import unicode_literals

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('grapher_admin', '0002_auto_20170525_1016'),
    ]

    operations = [
        migrations.AlterField(
            model_name='chart',
            name='last_edited_at',
            field=models.DateTimeField(),
        ),
        migrations.AlterField(
            model_name='chart',
            name='published',
            field=models.NullBooleanField(choices=[(None, 'false'), (True, 'true')], default=None),
        ),
    ]
